import {
  AlignStatusMessage,
  BridgeStatusMessage,
  HelloMessage,
  LidarMessage,
  PoseMessage,
  buildAlignMarker,
  buildAlignCommit,
  buildAlignStart,
  buildAlignStop,
  buildGetStatus,
  clearActiveRobotId,
  getActiveRobotId,
  parseInboundMessage,
  setActiveRobotId,
} from "./Protocol";
import { IP_STORAGE_KEY, WS_PORT } from "../UI/Shared/UIConstants";

const WS_CONNECTING = 0;
const WS_OPEN = 1;

@component
export class BridgeClient extends BaseScriptComponent {
  @input
  internetModule: InternetModule;

  public baseUrl: string = "";

  public onHello: ((msg: HelloMessage) => void)[] = [];
  public onLidar: ((msg: LidarMessage) => void)[] = [];
  public onPose: ((msg: PoseMessage) => void)[] = [];
  public onAlignStatus: ((msg: AlignStatusMessage) => void)[] = [];
  public onBridgeStatus: ((msg: BridgeStatusMessage) => void)[] = [];
  public onConnectionChanged: ((connected: boolean) => void)[] = [];

  private ws: WebSocket | null = null;
  private isConnecting = false;
  private helloReceived = false;
  private _activeRobotId: string | null = null;
  public lastBridgeStatus: BridgeStatusMessage | null = null;

  /** Lens Studio may not run field initializers before other scripts read these arrays. */
  public ensureEventHandlers(): void {
    if (!this.onHello) {
      this.onHello = [];
    }
    if (!this.onLidar) {
      this.onLidar = [];
    }
    if (!this.onPose) {
      this.onPose = [];
    }
    if (!this.onAlignStatus) {
      this.onAlignStatus = [];
    }
    if (!this.onConnectionChanged) {
      this.onConnectionChanged = [];
    }
    if (!this.onBridgeStatus) {
      this.onBridgeStatus = [];
    }
  }

  onAwake() {
    this.ensureEventHandlers();
    const saved = this.loadIp();
    if (saved) {
      this.baseUrl = saved;
    }
  }

  private get store(): GeneralDataStore {
    return global.persistentStorageSystem.store;
  }

  /** Strip protocol prefix, port, and trailing slashes to get a bare IP/hostname. */
  public static normalizeIp(raw: string): string {
    let host = raw.trim();
    if (host.startsWith("http://")) host = host.substring(7);
    if (host.startsWith("https://")) host = host.substring(8);
    if (host.startsWith("ws://")) host = host.substring(5);
    if (host.startsWith("wss://")) host = host.substring(6);
    while (host.endsWith("/")) host = host.substring(0, host.length - 1);
    const colonIdx = host.lastIndexOf(":");
    if (colonIdx > 0) {
      host = host.substring(0, colonIdx);
    }
    return host;
  }

  public saveIp(ip: string): void {
    this.store.putString(IP_STORAGE_KEY, BridgeClient.normalizeIp(ip));
  }

  public loadIp(): string | null {
    if (this.store.has(IP_STORAGE_KEY)) {
      return BridgeClient.normalizeIp(this.store.getString(IP_STORAGE_KEY));
    }
    return null;
  }

  private deriveWsUrl(input: string): string {
    const host = BridgeClient.normalizeIp(input);
    return `ws://${host}:${WS_PORT}`;
  }

  public async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WS_OPEN) {
      return;
    }
    if (this.isConnecting) {
      return;
    }
    this.disconnect();
    this.isConnecting = true;

    const wsUrl = this.deriveWsUrl(this.baseUrl);
    print(`BridgeClient: connecting to ${wsUrl}`);

    return new Promise((resolve, reject) => {
      try {
        this.ws = this.internetModule.createWebSocket(wsUrl);
      } catch (error) {
        this.isConnecting = false;
        reject(new Error(`Failed to create WebSocket: ${error}`));
        return;
      }

      this.ws.onopen = () => {
        this.isConnecting = false;
        print(`BridgeClient: connected`);
        resolve();
      };

      this.ws.onmessage = (event: WebSocketMessageEvent) => {
        this._onMessage(event);
      };

      this.ws.onerror = () => {
        this.isConnecting = false;
        this._notifyConnection(false);
        reject(new Error("WebSocket connection error"));
      };

      this.ws.onclose = () => {
        this.ws = null;
        this.helloReceived = false;
        this._activeRobotId = null;
        clearActiveRobotId();
        this.lastBridgeStatus = null;
        this._notifyConnection(false);
      };

      const timeout = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
      timeout.bind(() => {
        if (this.isConnecting) {
          this.isConnecting = false;
          if (this.ws) {
            this.ws.close();
            this.ws = null;
          }
          reject(new Error("WebSocket connection timeout"));
        }
      });
      timeout.reset(5.0);
    });
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.isConnecting = false;
    this.helloReceived = false;
    this._activeRobotId = null;
    clearActiveRobotId();
    this.lastBridgeStatus = null;
    this._notifyConnection(false);
  }

  public get activeRobotId(): string | null {
    return this._activeRobotId;
  }

  public requestStatus(): boolean {
    const robotId = this._requireRobotId("get_status");
    if (!robotId) {
      return false;
    }
    this.send(buildGetStatus(robotId));
    return true;
  }

  public sendAlignStart(): boolean {
    const robotId = this._requireRobotId("align_start");
    if (!robotId) {
      return false;
    }
    this.send(buildAlignStart(robotId));
    return true;
  }

  public sendAlignStop(): boolean {
    const robotId = this._requireRobotId("align_stop");
    if (!robotId) {
      return false;
    }
    this.send(buildAlignStop(robotId));
    return true;
  }

  public sendAlignCommit(): boolean {
    const robotId = this._requireRobotId("align_commit");
    if (!robotId) {
      return false;
    }
    this.send(buildAlignCommit(robotId));
    return true;
  }

  public sendAlignMarker(position: vec3, rotation: quat): boolean {
    const robotId = this._requireRobotId("align_marker");
    if (!robotId) {
      return false;
    }
    this.send(buildAlignMarker(position, rotation, robotId));
    return true;
  }

  /** Wait for server `hello` after the socket is open (bridge sends it on connect). */
  public waitForHello(timeoutSeconds: number = 3.0): Promise<boolean> {
    if (this.helloReceived) {
      return Promise.resolve(true);
    }
    if (!this.ws || this.ws.readyState !== WS_OPEN) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        const idx = this.onHello.indexOf(onHello);
        if (idx >= 0) {
          this.onHello.splice(idx, 1);
        }
        resolve(ok);
      };
      const onHello = () => finish(true);
      this.ensureEventHandlers();
      this.onHello.push(onHello);
      const timeout = this.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent;
      timeout.bind(() => finish(false));
      timeout.reset(timeoutSeconds);
    });
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WS_OPEN && this.helloReceived;
  }

  public send(text: string): void {
    if (this.ws && this.ws.readyState === WS_OPEN) {
      this.ws.send(text);
    }
  }

  private _onMessage(event: WebSocketMessageEvent): void {
    this.ensureEventHandlers();
    try {
      const raw = event.data as string;
      const msg = parseInboundMessage(raw);
      if (!msg) {
        return;
      }
      switch (msg.type) {
        case "hello":
          this.helloReceived = true;
          this._adoptRobotId(msg.robots.length > 0 ? msg.robots[0] : null);
          this._notifyConnection(true);
          this.onHello.forEach((cb) => cb(msg));
          break;
        case "lidar":
          this._adoptRobotId(msg.robot_id);
          this.onLidar.forEach((cb) => cb(msg));
          break;
        case "pose":
          this._adoptRobotId(msg.robot_id);
          this.onPose.forEach((cb) => cb(msg));
          break;
        case "align_status":
          this._adoptRobotId(msg.robot_id);
          this.onAlignStatus.forEach((cb) => cb(msg));
          break;
        case "bridge_status":
          this._adoptRobotId(msg.robot_id);
          this.lastBridgeStatus = msg;
          this.onBridgeStatus.forEach((cb) => cb(msg));
          break;
      }
    } catch (error) {
      const raw = event.data as string;
      print(
        `BridgeClient: parse error ${error}; len=${raw.length}; first="${this._snippet(
          raw,
          0,
        )}" last="${this._snippet(raw, Math.max(0, raw.length - 80))}"`,
      );
    }
  }

  private _notifyConnection(connected: boolean): void {
    this.onConnectionChanged.forEach((cb) => cb(connected));
  }

  private _adoptRobotId(robotId: string | null): void {
    if (!robotId) {
      return;
    }
    this._activeRobotId = robotId;
    if (getActiveRobotId() !== robotId) {
      setActiveRobotId(robotId);
    }
  }

  private _requireRobotId(action: string): string | null {
    const robotId = this._activeRobotId ?? getActiveRobotId();
    if (!robotId) {
      print(`BridgeClient: cannot send ${action} before hello negotiates robot_id`);
      return null;
    }
    this._activeRobotId = robotId;
    return robotId;
  }

  private _snippet(text: string, start: number): string {
    return text
      .substring(start, Math.min(text.length, start + 80))
      .replace("\n", "\\n")
      .replace("\r", "\\r");
  }
}
