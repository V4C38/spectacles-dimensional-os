/** Keep the wire source choice explicit; UI labels do not decide hardware admission. */
export function sourceRequest({ selection, address, replay, playback, streams }) {
  return {
    mode: selection.startsWith("device:") ? "device" : selection,
    device_id: selection.startsWith("device:") ? selection.slice(7) : null,
    address: address.trim(), replay: replay.trim() || null, playback,
    streams: { ...streams },
  };
}

export function replayRobot(robot) {
  return robot === "unitree_go2" ? "go2" : robot;
}

export function replayPreferenceKey(robot) {
  return robot === "openyam" ? "openyam_replay" : "replay";
}

/** Metadata comes from the launcher; this owner keeps only the user's selection. */
export class LaunchConfiguration {
  constructor({ blueprint = "", client = "webxr" } = {}) {
    this._blueprint = blueprint;
    this._client = client;
    this.selectionRevision = 0;
    this.blueprints = new Map();
    this.logLevels = [];
    this.defaultLogLevel = "";
  }

  configure(defaults) {
    this.blueprints = new Map(defaults.blueprints.map(spec => [spec.id, Object.freeze({ ...spec })]));
    if (!this.blueprints.has(this.blueprint)) this.selectBlueprint(defaults.blueprints[0]?.id ?? "");
    this.logLevels = [...defaults.log_levels];
    this.defaultLogLevel = defaults.log_level;
  }

  get blueprint() { return this._blueprint; }
  get client() { return this._client; }
  selectBlueprint(id) {
    if (this.blueprints.size && !this.blueprints.has(id)) return false;
    if (id !== this._blueprint) this.selectionRevision++;
    this._blueprint = id;
    return true;
  }
  selectClient(client) { this._client = client; }

  get spec() { return this.blueprints.get(this.blueprint) ?? null; }
  get robot() { return this.spec?.robot ?? null; }
  get replayRobot() { return replayRobot(this.robot); }
  get manipulation() { return this.spec?.manipulation === true; }
}

/** One request may publish only while its original selection is still current. */
export class ScopedRequests {
  constructor() { this.requests = new Map(); }

  begin(key, scope) {
    const identity = scope();
    const token = {
      current: () => this.requests.get(key) === token && scope() === identity,
      finish: () => { if (this.requests.get(key) === token) this.requests.delete(key); },
    };
    this.requests.set(key, token);
    return token;
  }

  busy(key) { return this.requests.get(key)?.current() === true; }
  cancel(key) { this.requests.delete(key); }
  clear() { this.requests.clear(); }
}

/** Service readiness and discovery facts have one owner independent of the DOM. */
export class HardwareDiscovery {
  constructor(request) {
    this.request = (path, options) => request(path, options);
    this.requests = new ScopedRequests();
    this.canStatus = { ready: false, state: "checking", message: "Checking can0…" };
    this.plannerStatus = { ready: false, state: "checking", message: "Checking manipulation dependencies…" };
    this.resolvedCan = "can0";
    this.go2DiscoveryState = { text: "Not scanned", phase: "" };
    this.plannerPython = null;
    this.discoveredRobots = { go2: [], openyam: [] };
  }

  observeStatus(status) {
    const python = status.dimos_python || null;
    const changed = python !== this.plannerPython;
    this.plannerPython = python;
    if (status.planner) this.plannerStatus = status.planner;
    return changed;
  }

  async json(path, fallback, options) {
    const response = await this.request(path, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || fallback);
    return data;
  }

  async run(key, scope, load, apply, failed, changed) {
    const request = this.requests.begin(key, scope);
    try {
      const data = await load();
      if (request.current()) apply(data);
    } catch (error) {
      if (request.current()) failed(error);
    } finally {
      request.finish();
      changed();
    }
  }

  refreshCan({ enabled, scope, interface: name, changed }) {
    if (!enabled || this.requests.busy("can") || this.requests.busy("canSetup")) return;
    return this.run("can", scope,
      () => this.json(`/api/can/status?interface=${encodeURIComponent(name)}`, "CAN status check failed"),
      data => { this.canStatus = data; },
      error => { this.canStatus = { ready: false, state: "error", message: String(error) }; }, changed);
  }

  refreshPlanner({ enabled, scope, changed }) {
    if (!enabled || this.requests.busy("planner")) return;
    return this.run("planner", scope,
      () => this.json("/api/planner/status", "Planner dependency check failed"),
      data => { this.plannerStatus = data; },
      error => { this.plannerStatus = { ready: false, state: "error", message: String(error) }; }, changed);
  }

  setupCan({ enabled, scope, interface: name, progress, changed }) {
    if (!enabled || this.requests.busy("canSetup")) return;
    // The owner owns the in-flight interval; callbacks only project its progress.
    return this.run("canSetup", scope, () => {
      progress({ phase: "checking" });
      changed();
      return this.json(`/api/can/setup?interface=${encodeURIComponent(name)}`, "CAN setup failed", { method: "POST" });
    }, data => {
      this.canStatus = data;
      progress({ phase: "ready", data });
    }, error => {
      this.canStatus = { ready: false, state: "error", message: String(error) };
      progress({ phase: "error", error });
    }, changed);
  }

  discover({ enabled, robot, auto, scope, progress, received, changed }) {
    if (!enabled || this.requests.busy("discovery")) return;
    return this.run("discovery", scope, () => {
      if (robot === "unitree_go2") this.go2DiscoveryState = { text: "Scanning…", phase: "checking" };
      progress({ phase: "checking" });
      changed();
      return this.json(`/api/discovery?robot=${robot}`, "Discovery failed");
    }, data => {
      this.discoveredRobots[replayRobot(robot)] = data.devices;
      if (robot === "openyam" && auto() && data.devices.length === 1) this.resolvedCan = data.devices[0].address;
      if (robot === "unitree_go2") this.go2DiscoveryState = {
        text: data.devices.length ? `${data.devices.length} found` : "None found",
        phase: data.devices.length ? "ready" : "needs_setup",
      };
      received(data);
    }, error => {
      if (robot === "unitree_go2") this.go2DiscoveryState = { text: "Discovery failed", phase: "error" };
      progress({ phase: "error", error });
    }, changed);
  }
}
