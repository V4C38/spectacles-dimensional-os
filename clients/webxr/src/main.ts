import { resolvePinConnection } from "./websocket/PinConnectionResolver";
import { validPin } from "@dimos-ar-client/websocket/ConnectionResolution";
import { EnvironmentDepthRenderer } from "./presentation/EnvironmentDepthRenderer";
import { BrowserJpegEncoder } from "./localization/BrowserJpegEncoder";
import { LandingInfoPresenter } from "./presentation/LandingInfoPresenter";
import { applyDOMDesign } from "./presentation/DimOSARDesign";
import * as xb from "xrblocks";
import { EMPTY_RAY_LENGTH_M } from "./input/XRBlocksRayInteraction";
import { reportBrowserError, reportDiagnostic } from "./diagnostics/BrowserDiagnostics";
import { HMD_OPTIONS, parseHmdId } from "./localization/HmdCalibration";
import { profileForHmd } from "./localization/HmdProfiles";
import {
  browserMediaPort,
  HmdCameraSource,
  videoFrameCallbackPort,
} from "./localization/HmdCameraSource";
import { browserRecognition, browserSynthesis } from "./agent/BrowserSpeechAdapters";
import { DimOSWebXRClient } from "./DimOSWebXRClient";
import { toneCss } from "./presentation/StatusTones";
import { WebXRApp } from "./WebXRApp";
import { arModuleSameOriginUrl } from "./WebXRRuntimeConfig";
import { BrowserClientClock } from "./utilities/BrowserClientClock";
import { BrowserWebSocketTransport } from "./websocket/BrowserWebSocketTransport";
import type { StatusTone } from "@dimos-ar-client/websocket/sessionLinkStatus";

function setStatus(text: string, tone: StatusTone = "neutral"): void {
  const node = document.getElementById("status");
  if (node) {
    node.textContent = text;
    node.style.color = toneCss(tone);
  }
}

class LandingError extends Error {
  readonly tone: StatusTone;

  constructor(message: string, tone: StatusTone) {
    super(message);
    this.tone = tone;
  }
}

function setStatusFromUnknown(error: unknown): void {
  if (error instanceof LandingError) {
    setStatus(error.message, error.tone);
    return;
  }
  reportBrowserError(error);
  setStatus(error instanceof Error ? error.message : String(error), "error");
}

function populateHmdSelect(select: HTMLSelectElement): void {
  for (const option of HMD_OPTIONS) {
    const node = document.createElement("option");
    node.value = option.id;
    node.textContent = option.label;
    if (option.id === "quest3") {
      node.selected = true;
    }
    select.append(node);
  }
  select.value = "quest3";
}

async function requireImmersiveAr(): Promise<void> {
  const xr = (navigator as Navigator & { xr?: { isSessionSupported?(mode: string): Promise<boolean> } }).xr;
  if (!xr?.isSessionSupported || !(await xr.isSessionSupported("immersive-ar"))) {
    throw new LandingError("WebXR cannot start from a desktop browser.", "warn");
  }
}

type XRSystemWithOffer = XRSystem & {
  offerSession?: (mode: XRSessionMode, options?: XRSessionInit) => Promise<XRSession>;
};

function selectedProfile(select: HTMLSelectElement): ReturnType<typeof profileForHmd> {
  return profileForHmd(parseHmdId(select.value));
}

function startImmersiveSession(onError: (error: unknown) => void): void {
  const xr = navigator.xr;
  const manager = xb.core.webXRSessionManager;
  if (!xr || !manager) {
    throw new Error("WebXR is not ready");
  }
  const requestSession = xr.requestSession.bind(xr);
  let restored = false;
  const restore = () => {
    if (restored) {
      return;
    }
    xr.requestSession = requestSession;
    restored = true;
  };
  xr.requestSession = ((mode, options) => {
    restore();
    return requestSession(mode, mode === "immersive-ar" ? EnvironmentDepthRenderer.sessionOptions(options) : options).catch((error: unknown) => {
      onError(error);
      throw error;
    });
  }) as typeof xr.requestSession;
  try {
    manager.startSession();
  } catch (error) {
    restore();
    throw error;
  }
}

async function boot(): Promise<void> {
  window.addEventListener("error", event => reportBrowserError(event.error ?? event.message));
  window.addEventListener("unhandledrejection", event => reportBrowserError(event.reason));
  xb.core.scriptsManager.addEventListener("exception" as keyof xb.ScriptsManagerEventMap, event => {
    if ("error" in event) reportBrowserError(event.error);
  });
  const enter = document.getElementById("enter") as HTMLButtonElement | null;
  const select = document.getElementById("hmd") as HTMLSelectElement | null;
  const pinInput = document.getElementById("pin") as HTMLInputElement;
  const connect = document.getElementById("connect") as HTMLButtonElement;
  const localConnection = new URLSearchParams(location.search).get("connection") === "local";
  const controls = document.getElementById("connection-controls");
  if (controls) controls.hidden = localConnection;
  try { pinInput.value = new URLSearchParams(location.search).get("pin") ?? localStorage.getItem("dimos_ar_module_pin") ?? ""; } catch { /* Storage can be disabled. */ }
  const overlay = document.getElementById("overlay");
  const infoRoot = document.querySelector<HTMLElement>(".landing-layout");
  const info = infoRoot ? new LandingInfoPresenter(infoRoot, window.location.host) : null;
  if (select) {
    populateHmdSelect(select);
  }
  try {
    const url = arModuleSameOriginUrl(window.location);
    setStatus("Checking headset support…", "muted");
    await requireImmersiveAr();
    if (!enter || !select) {
      throw new Error("Enter AR controls are missing");
    }
    const camera = new HmdCameraSource({
      clock: new BrowserClientClock(),
      profile: () => selectedProfile(select),
      media: browserMediaPort(),
      frames: videoFrameCallbackPort(),
      jpeg: new BrowserJpegEncoder(),
    });
    const transport = new BrowserWebSocketTransport({ url });
    const client = new DimOSWebXRClient({
      transport,
      clock: new BrowserClientClock(),
      camera,
      recognition: browserRecognition(),
      synthesis: browserSynthesis(),
    });
    info?.bind(client.session);
    const options = new xb.Options();
    options.xrButton.enabled = false;
    // AgentDraftSession owns speech; do not instantiate SDK recognition or its default tones.
    options.sound.speechRecognizer.enabled = false;
    options.referenceSpaceType = "local-floor";
    options.enableHands();
    options.enableUI();
    options.enablePlaneDetection();
    options.controllers.enabled = true;
    options.controllers.visualizeRays = false;
    options.controllers.visualization = true;
    options.hands.visualization = true;
    options.hands.visualizeMeshes = true;
    options.reticles.enabled = true;
    options.reticles.defaultDistance = EMPTY_RAY_LENGTH_M;
    const app = new WebXRApp(client);
    xb.add(app);
    const xr = navigator.xr as XRSystemWithOffer | undefined;
    const offerSession = xr?.offerSession;
    if (xr) {
      xr.offerSession = undefined;
    }
    try {
      setStatus("Loading AR…", "muted");
      await xb.init(options);
      if (!app.isReady) throw new Error("WebXR app initialization failed. See the launcher log.");
      reportDiagnostic("ready", { hmd: select.value });
    } finally {
      if (xr && offerSession) {
        xr.offerSession = offerSession;
      }
    }
    let wantsConnection = localConnection;
    if (wantsConnection) client.session.start();
    let connectionGeneration = 0;
    let lastConnection: string | null = null;
    const unsubscribeConnection = client.session.subscribeView(view => {
      if (localConnection || lastConnection === view.connection) return;
      lastConnection = view.connection;
      enter.disabled = view.connection !== "ready";
      connect.textContent = view.connection === "ready" ? "Reconnect" : view.connection === "connecting" || view.connection === "awaiting_hello" ? "Connecting…" : "Connect";
      if (view.connection === "ready") setStatus("Connected", "success");
    });
    connect.disabled = !validPin(pinInput.value.trim());
    const disconnect = () => {
      connectionGeneration++; wantsConnection = false;
      client.suspend(); client.session.stop(); client.restartSetup();
      cameraReady = false; enter.textContent = "Allow camera"; enter.disabled = true;
    };
    pinInput.oninput = () => {
      disconnect(); connect.disabled = !validPin(pinInput.value.trim()); setStatus("", "muted");
    };
    connect.onclick = () => {
      const pin = pinInput.value.trim();
      if (!validPin(pin)) { setStatus("Enter a 6-digit PIN", "warn"); return; }
      disconnect();
      try { localStorage.setItem("dimos_ar_module_pin", pin); } catch { /* Storage can be disabled. */ }
      const generation = connectionGeneration;
      transport.setConnectionResolver(() => resolvePinConnection(pin, location.origin).catch(error => {
        if (generation === connectionGeneration) setStatusFromUnknown(error); throw error;
      }));
      wantsConnection = true; setStatus("Connecting…", "muted"); client.session.start();
    };
    const landingTick = window.setInterval(() => {
      if (document.visibilityState !== "visible" || xb.core.renderer.xr.isPresenting) return;
      if (wantsConnection && client.session.view().connection === "disconnected") client.session.start();
      client.session.tick();
    }, 100);
    let cameraReady = false;
    const onStarted = () => {
      select.disabled = true; pinInput.disabled = true; connect.disabled = true;
      if (overlay) overlay.style.display = "none";
    };
    const onEnded = () => {
      if (overlay) overlay.style.display = "";
      select.disabled = false; pinInput.disabled = false; connect.disabled = !validPin(pinInput.value.trim());
      enter.disabled = !localConnection && client.session.view().connection !== "ready";
      cameraReady = false;
      enter.textContent = "Allow camera";
      setStatus("", "muted");
    };
    xb.core.renderer.xr.addEventListener("sessionstart", onStarted);
    xb.core.renderer.xr.addEventListener("sessionend", onEnded);
    window.addEventListener("pagehide", event => {
      if (event.persisted) { app.onXRSessionEnded(); onEnded(); return; }
      xb.core.renderer.xr.removeEventListener("sessionstart", onStarted);
      xb.core.renderer.xr.removeEventListener("sessionend", onEnded);
      window.clearInterval(landingTick); info?.dispose(); unsubscribeConnection();
      connect.onclick = null; pinInput.oninput = null;
      enter.onclick = null;
      app.dispose();
    });
    setStatus("", "muted");
    enter.textContent = "Allow camera";
    select.onchange = () => {
      cameraReady = false;
      enter.textContent = "Allow camera";
      setStatus("", "muted");
    };
    select.disabled = false;
    enter.disabled = !localConnection && client.session.view().connection !== "ready";
    enter.onclick = () => {
      void app.sound.unlock();
      enter.disabled = true;
      if (!cameraReady) {
        select.disabled = true; pinInput.disabled = true; connect.disabled = true;
        setStatus("Allow camera access in the browser prompt…", "muted");
        void camera.requestPermission().then(() => {
          cameraReady = true;
          enter.textContent = "Enter AR";
          setStatus("", "muted");
          reportDiagnostic("camera-permission-granted", { hmd: select.value });
        }, error => {
          reportDiagnostic("camera-preflight-failed", { hmd: select.value, message: String(error) });
          setStatusFromUnknown(error);
        }).finally(() => {
          enter.disabled = !localConnection && client.session.view().connection !== "ready";
          select.disabled = false; pinInput.disabled = false; connect.disabled = !validPin(pinInput.value.trim());
        });
        return;
      }
      // A separate click preserves WebXR activation after camera permission UI.
      try {
        startImmersiveSession(error => {
          setStatusFromUnknown(error);
          enter.disabled = false;
        });
      } catch (error) {
        setStatusFromUnknown(error);
        enter.disabled = false;
      }
    };
  } catch (error) {
    setStatusFromUnknown(error);
    if (enter) {
      enter.disabled = true;
    }
  }
}

applyDOMDesign(document.documentElement);
void boot();
