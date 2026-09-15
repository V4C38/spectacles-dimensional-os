import * as xb from "xrblocks";
import type { StatusTone } from "@dimos-ar-client/websocket/sessionLinkStatus";
import { toneCss } from "./tones";
import type { WebXRUISnapshot } from "./WebXRUIPresenter";

export type MainMenuCallbacks = {
  onSetup: () => void;
  onRestart: () => void;
  onMenu: () => void;
  onMode: () => void;
  onLidar: () => void;
  onLocalize: () => void;
  onEstop: () => void;
};

type PanelText = { text?: string; color?: string; onSelectEnd?: () => void };

export class MainMenuView {
  readonly panel: xb.SpatialPanel;
  private readonly status: PanelText;
  private readonly capture: PanelText;
  private readonly hud: PanelText;
  private readonly agent: PanelText;
  private readonly setup: PanelText;
  private readonly mode: PanelText;
  private readonly lidar: PanelText;
  private readonly estop: PanelText;

  constructor(handlers: MainMenuCallbacks) {
    const panel = new xb.SpatialPanel({
      width: 0.46,
      height: 0.58,
      backgroundColor: "#1b1f2488",
    });
    panel.position.set(0, 1.3, -0.7);
    const grid = panel.addGrid();
    this.status = grid.addRow({ weight: 0.16 }).addText({ text: "DimOS", fontSize: 0.036 });
    this.capture = grid.addRow({ weight: 0.12 }).addText({ text: "", fontSize: 0.028 });
    this.hud = grid.addRow({ weight: 0.1 }).addText({ text: "", fontSize: 0.028 });
    this.agent = grid.addRow({ weight: 0.12 }).addText({ text: "", fontSize: 0.026 });
    const row = grid.addRow({ weight: 0.16 });
    this.setup = row.addCol({ weight: 0.5 }).addText({ text: "Setup", fontSize: 0.028 });
    bindButton(this.setup, () => {
      if (this.setup.text === "Restart") {
        handlers.onRestart();
        return;
      }
      handlers.onSetup();
    });
    bindButton(row.addCol({ weight: 0.5 }).addText({ text: "Menu", fontSize: 0.028 }), handlers.onMenu);
    const actions = grid.addRow({ weight: 0.16 });
    this.mode = actions.addCol({ weight: 0.33 }).addText({ text: "Mode", fontSize: 0.024 });
    this.lidar = actions.addCol({ weight: 0.33 }).addText({ text: "LiDAR", fontSize: 0.024 });
    bindButton(this.mode, handlers.onMode);
    bindButton(this.lidar, handlers.onLidar);
    bindButton(
      actions.addCol({ weight: 0.33 }).addText({ text: "Localize", fontSize: 0.024 }),
      handlers.onLocalize,
    );
    this.estop = grid.addRow({ weight: 0.14 }).addText({ text: "ESTOP", fontSize: 0.036 });
    bindButton(this.estop, handlers.onEstop);
    this.panel = panel;
  }

  apply(snap: WebXRUISnapshot): void {
    this.panel.visible = snap.menuOpen || !snap.setupCompleted;
    setColoredText(this.status, snap.connectionText, snap.connectionTone);
    setColoredText(this.capture, snap.captureText, snap.captureTone);
    setColoredText(this.hud, snap.hudText ?? "", snap.hudTone ?? "muted");
    setColoredText(this.agent, snap.agentMessage ?? "", "neutral");
    this.setup.text = snap.setupCompleted ? "Restart" : "Setup";
    this.mode.text = snap.agentAvailable ? `Mode: ${snap.operatingMode}` : "Mode";
    this.lidar.text = snap.lidarAvailable ? snap.lidarMode : "LiDAR";
    this.estop.text = snap.estopAvailable ? "ESTOP" : snap.estopReason ?? "ESTOP";
  }
}

function bindButton(target: { onSelectEnd?: () => void }, action: () => void): void {
  target.onSelectEnd = action;
}

function setColoredText(target: PanelText | undefined, value: string, tone: StatusTone): void {
  if (!target) {
    return;
  }
  target.text = value;
  target.color = toneCss(tone);
}
