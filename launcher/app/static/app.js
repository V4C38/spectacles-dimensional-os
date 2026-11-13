import { sourceRequest, replayPreferenceKey, LaunchConfiguration, HardwareDiscovery } from "./source-selection.mjs";
import { logConsole } from "./log-console.mjs";
import { settingsWriter, profilesForRobot, ProfileSettingsEditor, LauncherPreferences } from "./persistence.mjs";
import { launcherPresentation } from "./presentation.mjs";
(() => {
  const $ = (id) => document.getElementById(id);

  class LauncherConnection {
    constructor() {
      this.status = {};
      this.revision = 0;
      this.source = null;
      this.timer = null;
      this.onVisible = () => { if (!document.hidden) this.refreshHardware(); };
    }
    refreshHardware() { void refreshCan(); void refreshPlanner(); }
    publish(status) { applyStatus(status); }
    observe(status) {
      this.revision++;
      this.status = status || {};
    }
    applyResponse(status, revision) {
      if (this.revision === revision && (status.phase || "check_ok" in status)) this.publish(status);
    }
    start() {
      if (this.source) return;
      this.source = new EventSource("/api/events");
      this.source.onmessage = event => {
        let data;
        try { data = JSON.parse(event.data); } catch (_) { return; }
        if (data.type === "log") appendLog(data.line);
        else if (data.type === "status") this.publish(data);
      };
      const initialRevision = this.revision;
      const source = this.source;
      void fetch("/api/status").then(response => response.json()).then(status => {
        if (this.source === source && this.revision === initialRevision) this.publish(status);
      }).catch(() => {});
      this.timer = setInterval(() => this.refreshHardware(), 5000);
      document.addEventListener("visibilitychange", this.onVisible);
    }
    stop() {
      this.source?.close?.();
      this.source = null;
      clearInterval(this.timer);
      document.removeEventListener("visibilitychange", this.onVisible);
      editor.cancelScheduled();
      hardware.requests.clear();
      editor.requests.clear();
      preferences.requests.clear();
    }
  }

  const stateValue = $("stateValue");
  const stateDetail = $("stateDetail");
  const hostIp = $("hostIp");
  const pinValue = $("pin");
  const pinSummary = $("pinSummary");
  const webxrNetwork = $("webxrNetwork");
  const webxrNetworkRow = $("webxrNetworkRow");
  const webxrHint = $("webxrHint");
  const warningText = $("warningText");
  const errorText = $("errorText");
  const controlsCard = $("controlsCard");
  const actionsBar = $("actionsBar");
  const installBanner = $("installBanner");
  const installHint = $("installHint");
  const dimosVersionHint = $("dimosVersionHint");
  const depsSummary = $("depsSummary");
  const cloneDir = $("cloneDir");
  const dimosPython = $("dimosPython");
  const cloneDirField = $("cloneDirField");
  const dimosPythonField = $("dimosPythonField");
  const dimosRefField = $("dimosRefField");
  const dimosRef = $("dimosRef");
  const installBtn = $("installBtn");
  const startBtn = $("startBtn");
  const stopBtn = $("stopBtn");
  const robotIp = $("robotIp");
  const apiKey = $("apiKey");
  const revealKey = $("revealKey");
  const logEl = $("log");
  const copyLogBtn = $("copyLogBtn");
  const clearLogBtn = $("clearLogBtn");
  const logFilterLevel = $("logFilterLevel");
  const logFilterSource = $("logFilterSource");
  const sidePanel = $("sidePanel");
  const splitter = $("splitter");
  const tagList = $("tagList");
  const addTagBtn = $("addTagBtn");
  const restoreTagsBtn = $("restoreTagsBtn");
  const fiducialEnabled = $("fiducialEnabled");
  const vpsEnabled = $("vpsEnabled");
  const blueprintSelect = $("blueprintSelect");
  const blueprintInfo = $("blueprintInfo");
  const agentConfig = $("agentConfig");
  const locCard = $("locCard");
  const locSummary = $("locSummary");
  const agentSummary = $("agentSummary");
  const logSummary = $("logSummary");
  const logLevel = $("logLevel");
  const fiducialPanel = $("fiducialPanel");
  const vpsPanel = $("vpsPanel");
  const vpsVendor = $("vpsVendor");
  const mapCode = $("mapCode");
  const multisetClientId = $("multisetClientId");
  const multisetClientSecret = $("multisetClientSecret");
  const revealMultiset = $("revealMultiset");

  const { appendLog, clearLog, copyLog, applyLogFilter } = logConsole({ logEl, logFilterLevel, logFilterSource, copyLogBtn });

  const configuration = new LaunchConfiguration({ blueprint: blueprintSelect.value });
  const hardware = new HardwareDiscovery(fetch);
  const preferences = new LauncherPreferences();
  const service = new LauncherConnection();
  let keyVisible = false;
  let multisetVisible = false;

  const DEFAULT_MOUNT = {};

  let presetMarkerIds = [];

  const FIELD_META = [
    { field: "print_size_mm", label: "Print size (mm)", step: 1, min: 20, max: 200 },
    { field: "forward_m", label: "Forward (m)", step: 0.01 },
    { field: "lateral_m", label: "Lateral (m)", step: 0.01 },
    { field: "up_m", label: "Up (m)", step: 0.01 },
    { field: "yaw_deg", label: "Yaw (°)", step: 1 },
    { field: "pitch_deg", label: "Pitch (°)", step: 1 },
    { field: "roll_deg", label: "Roll (°)", step: 1 },
  ];

  const savedBlueprint = localStorage.getItem("dimos.blueprint");
  let metadataReady = false;
  const editor = new ProfileSettingsEditor(settingsWriter({
    request: body => fetch("/api/settings", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
    saved: (profileId, data) => editor.saved(profileId, data),
    failed: error => appendLog(`Settings save failed: ${error.message || error}`),
  }));

  function applyBlueprintInfo() {
    configuration.selectBlueprint(blueprintSelect.value);
    const spec = configuration.spec;
    if (!spec) return;
    blueprintInfo.textContent = spec.description || "";
    const manipulation = spec.manipulation;


    const rememberedSource = preferences.values[`${configuration.replayRobot}_source`] || "auto";
    renderSourceOptions(rememberedSource);
    $("editConnection").disabled = configIsLocked() || manipulation;
    $("connectionEditor").classList.add("hidden");
    syncSource();

    document.querySelectorAll("[data-client=specs]").forEach(button => { button.disabled = configIsLocked(); });
    if (editor.settingsReady) {
      void refreshRobotProfiles();
      if (rememberedSource.startsWith("device:")) void refreshRobotDiscovery();
    }
    agentConfig.classList.toggle("hidden", !spec.agent);
    syncConfigCards();
    syncHardwareSetup();
    if (manipulation) { void refreshCan(); void refreshPlanner(); }
  }

  function renderSourceOptions(selected = $("robotSource").value, missing = "saved") {
    const select = $("robotSource");
    select.querySelectorAll('[value^="device:"], [value="manual"]').forEach(option => option.remove());
    const add = (value, label) => {
      const option = document.createElement("option"); option.value = value; option.textContent = label;
      select.insertBefore(option, select.querySelector('[value="simulated"]'));
    };
    for (const device of (hardware.discoveredRobots[configuration.replayRobot] || [])) add(`device:${device.id}`, device.label || device.id);
    if (!manipulationSelected() && (robotIp.value.trim() || selected === "manual")) add("manual", `${robotIp.value.trim()} (manual)`);
    if (selected.startsWith("device:") && ![...select.options].some(option => option.value === selected)) add(selected, `${selected.slice(7)} (${missing})`);
    select.value = selected;
  }

  function manipulationSelected() { return configuration.manipulation; }
  function presentation() {
    return launcherPresentation({ status: service.status, manipulation: manipulationSelected(),
      simulated: $("robotSource").value === "simulated", can: hardware.canStatus, planner: hardware.plannerStatus,
      settingUp: Boolean(hardware.requests.busy("canSetup") || service.status.can_setup_running || hardware.canStatus.setting_up) });
  }
  function canRequired() { return presentation().canRequired; }
  function syncHardwareSetup() {
    const selected = manipulationSelected();
    const mock = ($("robotSource").value === "simulated" && manipulationSelected());
    const card = $("canCard");
    card.classList.toggle("hidden", !selected);
    $("webrtcCard").classList.toggle("hidden", selected);
    const simulated = $("robotSource").value === "simulated";
    $("webrtcSummary").textContent = simulated ? "Not required" : hardware.go2DiscoveryState.text;
    $("webrtcSummary").dataset.phase = simulated ? "" : hardware.go2DiscoveryState.phase;
    $("discoverWebrtc").disabled = configIsLocked() || simulated || hardware.requests.busy("discovery") || service.status.check_ok !== true;
    $("discoverWebrtc").textContent = hardware.requests.busy("discovery") ? "Scanning…" : "Discover";
    const missing = canRequired() && !hardware.canStatus.ready;
    card.classList.toggle("needs-setup", missing);
    const canNotRequired = mock || hardware.canStatus.state === "not_required";
    const canPhase = canNotRequired ? "" : hardware.canStatus.state === "error" ? "error" : hardware.canStatus.ready ? "ready" : hardware.canStatus.state === "checking" ? "checking" : "needs_setup";
    $("canSummary").textContent = canNotRequired ? "Not required" : hardware.canStatus.ready ? "Ready · 1 Mbit/s" : hardware.canStatus.state === "checking" ? "Checking…" : hardware.canStatus.state === "error" ? "Error" : "Setup needed";
    $("canSummary").dataset.phase = canPhase;
    $("canStatus").dataset.phase = canPhase;
    $("canStatus").classList.toggle("hidden", !canNotRequired && hardware.canStatus.ready);
    $("canStatus").textContent = mock ? "Not required for simulated connection." : hardware.canStatus.message;
    const settingUp = hardware.requests.busy("canSetup") || service.status.can_setup_running || hardware.canStatus.setting_up;
    $("canSetupBtn").textContent = settingUp ? "Setting up…" : "Set up CAN";
    $("canSetupBtn").disabled = !selected || mock || configIsLocked() || settingUp || canNotRequired || service.status.check_ok !== true || ["checking", "installing"].includes(service.status.phase);
    $("plannerStatus").classList.toggle("hidden", !selected);
    $("plannerStatus").textContent = hardware.plannerStatus.message || "Checking manipulation dependencies…";
    $("plannerStatus").dataset.phase = hardware.plannerStatus.state === "error" ? "error" : hardware.plannerStatus.ready ? "ready" : "checking";
    renderControls();
  }

  function environmentScope() {
    return JSON.stringify([configuration.selectionRevision, configuration.blueprint, hardware.plannerPython]);
  }
  function canScope() {
    return JSON.stringify([environmentScope(), $("robotSource").value, hardware.resolvedCan]);
  }
  function replayScope() {
    return JSON.stringify([environmentScope(), $("robotSource").value, $("playbackSource").value, $("replayPath").value.trim()]);
  }
  function canInterface() {
    const selection = $("robotSource").value;
    return selection.startsWith("device:") ? selection.slice(7) : hardware.resolvedCan;
  }

  function refreshCan() {
    return hardware.refreshCan({
      enabled: manipulationSelected() && !document.hidden,
      scope: canScope, interface: canInterface(), changed: syncHardwareSetup,
    });
  }
  function refreshPlanner() {
    return hardware.refreshPlanner({
      enabled: manipulationSelected() && !document.hidden,
      scope: environmentScope, changed: syncHardwareSetup,
    });
  }
  $("canSetupBtn").addEventListener("click", () => hardware.setupCan({
    enabled: !configIsLocked(), scope: canScope, interface: canInterface(), changed: syncHardwareSetup,
    progress: ({ phase, data, error }) => {
      const result = $("canSetupResult");
      result.classList.remove("hidden");
      result.dataset.phase = phase;
      if (phase === "checking") result.textContent = "Checking CAN configuration…";
      else if (phase === "ready") result.textContent = `Already set up on ${data.interface || hardware.resolvedCan}`;
      else {
        result.textContent = `CAN setup failed: ${error}`;
        appendLog(`CAN setup: ${error}`);
      }
    },
  }));

  function fiducialConfigured() {
    return editor.mounts.length > 0;
  }

  function vpsConfigured() {
    return Boolean(
      mapCode.value.trim() &&
        multisetClientId.value.trim() &&
        multisetClientSecret.value.trim()
    );
  }

  function locNotSetup() {
    const markerOn = fiducialEnabled.checked;
    const vpsOn = vpsEnabled.checked;
    if (!markerOn && !vpsOn) return true;
    if (markerOn && !fiducialConfigured()) return true;
    if (vpsOn && !vpsConfigured()) return true;
    return false;
  }

  function agentNotSetup() {
    return Boolean(configuration.spec?.agent) && !apiKey.value.trim();
  }

  function syncConfigCards(render = true) {
    const locMissing = locNotSetup();
    locCard.classList.toggle("needs-setup", locMissing);
    locSummary.textContent = locMissing ? "incomplete" : "";
    locSummary.dataset.phase = locMissing ? "needs_setup" : "";

    const agentMissing = agentNotSetup();
    agentConfig.classList.toggle("needs-setup", agentMissing);
    agentSummary.textContent = agentMissing ? "incomplete" : "";
    agentSummary.dataset.phase = agentMissing ? "needs_setup" : "";

    logSummary.textContent = logLevel.value || configuration.defaultLogLevel;
    logSummary.dataset.phase = "";
    if (render) renderControls();
  }

  function cloneMount(raw) {
    const src = { ...DEFAULT_MOUNT, ...raw };
    return {
      marker_id: Number(src.marker_id) || 0,
      print_size_mm: Number(src.print_size_mm),
      forward_m: Number(src.forward_m) || 0,
      lateral_m: Number(src.lateral_m) || 0,
      up_m: Number(src.up_m) || 0,
      yaw_deg: Number(src.yaw_deg) || 0,
      pitch_deg: Number(src.pitch_deg) || 0,
      roll_deg: Number(src.roll_deg) || 0,
    };
  }

  function schedulePersist() {
    if (configIsLocked()) return;
    editor.schedule(settingsBody);
  }

  const policyDefaults = {};
  const policyKeys = [...document.querySelectorAll("[data-localization-policy]")].map(input => input.id);
  const policyInputs = Object.fromEntries(policyKeys.map(key => [key, $(key)]));
  Object.values(policyInputs).forEach(input => {
    input.addEventListener("change", () => { if (input.reportValidity()) schedulePersist(); });
    input.addEventListener("blur", () => { if (input.reportValidity()) schedulePersist(); });
  });

  function settingsBody() {
    return {
      profile_id: editor.robotProfileId,
      ...Object.fromEntries(Object.entries(policyInputs).map(([key, input]) => [key, Number(input.value)])),
      openai_api_key: apiKey.value.trim() || null,
      multiset_client_id: multisetClientId.value.trim() || null,
      multiset_client_secret: multisetClientSecret.value.trim() || null,
      fiducial_marker: fiducialEnabled.checked,
      vps: vpsEnabled.checked,
      vps_vendor: vpsVendor.value || "multiset",
      map_code: mapCode.value.trim() || null,
      mounts: editor.mounts,
      dimos_log_level: logLevel.value || configuration.defaultLogLevel,
    };
  }

  function saveSettings() { return editor.save(settingsBody()); }
  async function flushSettings() { return saveSettings(); }

  function applySettingsPayload(data) {
    if (!metadataReady) {
      configuration.selectBlueprint(savedBlueprint || blueprintSelect.value);
      configuration.configure(data.defaults);
      blueprintSelect.replaceChildren(...data.defaults.blueprints.map(spec => {
        const option = document.createElement("option");
        option.value = spec.id;
        option.textContent = spec.label;
        return option;
      }));
      blueprintSelect.value = configuration.blueprint;
      logLevel.replaceChildren(...configuration.logLevels.map(level => {
        const option = document.createElement("option");
        option.value = level;
        option.textContent = level;
        return option;
      }));
      metadataReady = true;
    }
    Object.assign(policyDefaults, data.defaults.localization);
    if (data.defaults?.mounts?.[0]) {
      Object.assign(DEFAULT_MOUNT, cloneMount(data.defaults.mounts[0]));
    }
    if (Array.isArray(data.defaults?.preset_marker_ids) && data.defaults.preset_marker_ids.length) {
      presetMarkerIds = [...data.defaults.preset_marker_ids];
    }
    const loaded = Array.isArray(data.mounts) && data.mounts.length ? data.mounts : [DEFAULT_MOUNT];
    editor.mounts = loaded.map((item) => cloneMount(item));
    fiducialEnabled.checked = Boolean(data.fiducial_marker);
    vpsEnabled.checked = Boolean(data.vps);
    vpsVendor.value = data.vps_vendor || "multiset";
    if (document.activeElement !== mapCode) {
      mapCode.value = data.map_code || "";
    }
    if (document.activeElement !== apiKey && "openai_api_key" in data) {
      apiKey.value = data.openai_api_key || "";
    }
    if (document.activeElement !== logLevel && "dimos_log_level" in data) {
      const level = String(data.dimos_log_level || configuration.defaultLogLevel).toUpperCase();
      logLevel.value = configuration.logLevels.includes(level) ? level : configuration.defaultLogLevel;
    }
    if (document.activeElement !== multisetClientId && "multiset_client_id" in data) {
      multisetClientId.value = data.multiset_client_id || "";
    }
    if (document.activeElement !== multisetClientSecret && "multiset_client_secret" in data) {
      multisetClientSecret.value = data.multiset_client_secret || "";
    }
    Object.entries(policyInputs).forEach(([key, input]) => {
      if (document.activeElement !== input) input.value = String(data[key] ?? policyDefaults[key]);
    });
    editor.settingsReady = true;
    syncLocalizationPanels();
    renderMountEditor();
    applyBlueprintInfo();
  }

  function configIsLocked() { return presentation().locked; }

  function setConfigLocked(locked) {
    Object.values(policyInputs).forEach(input => { input.disabled = locked; });
    controlsCard.classList.toggle("locked", locked);
    document.querySelectorAll("[data-client]").forEach((btn) => {
      btn.disabled = locked;
    });
    blueprintSelect.disabled = locked;
    for (const id of ["robotProfileSelect", "robotProfileName", "newRobotProfile", "deleteRobotProfile", "robotSource", "refreshRobots", "playbackSource", "editConnection", "saveRobotIp", "cancelRobotIp", "robotIp", "editReplay", "replayPath", "browseReplay", "defaultReplay", "profileEdit", "profileDone", "saveProfileName", "cancelProfileName", "confirmDeleteProfile"]) { const control = $(id); if (control) control.disabled = locked; }
    apiKey.disabled = locked;
    revealKey.disabled = locked;
    fiducialEnabled.disabled = locked;
    vpsEnabled.disabled = locked;
    vpsVendor.disabled = locked;
    mapCode.disabled = locked;
    multisetClientId.disabled = locked;
    multisetClientSecret.disabled = locked;
    revealMultiset.disabled = locked;
    logLevel.disabled = locked;
    addTagBtn.disabled = locked;
    restoreTagsBtn.disabled = locked;
    tagList.querySelectorAll("input, button, label").forEach((el) => {
      el.disabled = locked;
    });
    $("editConnection").disabled = locked || manipulationSelected();
    $("editReplay").disabled = locked || $("playbackSource").value !== "recording";
  }

  function makeNumInput(meta, value, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "num-input";

    const dec = document.createElement("button");
    dec.type = "button";
    dec.className = "num-btn";
    dec.textContent = "−";
    dec.setAttribute("aria-label", `Decrease ${meta.label}`);

    const input = document.createElement("input");
    input.type = "number";
    input.step = String(meta.step);
    if (meta.min != null) input.min = String(meta.min);
    if (meta.max != null) input.max = String(meta.max);
    input.value = String(Number(Number(value).toFixed(6)));
    input.dataset.field = meta.field;
    input.setAttribute("aria-label", meta.label);
    input.disabled = configIsLocked();

    const inc = document.createElement("button");
    inc.type = "button";
    inc.className = "num-btn";
    inc.textContent = "+";
    inc.setAttribute("aria-label", `Increase ${meta.label}`);

    const commit = (next) => {
      let n = Number(next);
      if (!Number.isFinite(n)) n = 0;
      if (meta.min != null) n = Math.max(meta.min, n);
      if (meta.max != null) n = Math.min(meta.max, n);
      if (meta.field === "print_size_mm" && n <= 0) n = DEFAULT_MOUNT.print_size_mm;
      input.value = String(n);
      onChange(n);
    };

    dec.addEventListener("click", () => {
      if (configIsLocked()) return;
      commit(Number(input.value) - meta.step);
    });
    inc.addEventListener("click", () => {
      if (configIsLocked()) return;
      commit(Number(input.value) + meta.step);
    });
    input.addEventListener("change", () => commit(input.value));

    dec.disabled = configIsLocked();
    inc.disabled = configIsLocked();
    wrap.append(dec, input, inc);
    return wrap;
  }

  function usedMarkerIds(exceptIndex) {
    return new Set(
      editor.mounts
        .map((item, index) => (index === exceptIndex ? null : item.marker_id))
        .filter((id) => id != null)
    );
  }

  function nextUnusedPresetId() {
    const used = usedMarkerIds();
    return presetMarkerIds.find((id) => !used.has(id));
  }

  function isPresetId(id) {
    return presetMarkerIds.includes(Number(id));
  }

  async function decodeUploadedPng(file) {
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/apriltag/decode", { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data.detail || res.statusText;
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    return Number(data.marker_id);
  }

  function assignMarkerId(index, markerId) {
    const used = usedMarkerIds(index);
    if (used.has(markerId)) {
      appendLog(`Fiducial marker ID ${markerId} is already in the list`);
      return false;
    }
    editor.mounts[index] = { ...editor.mounts[index], marker_id: markerId };
    return true;
  }

  function makeFileInput(onFile) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png";
    input.hidden = true;
    input.disabled = configIsLocked();
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      input.value = "";
      if (!file || configIsLocked()) return;
      try {
        await onFile(file);
      } catch (err) {
        appendLog(`PNG upload failed: ${err.message || err}`);
      }
    });
    return input;
  }

  function renderMountEditor() {
    if (!editor.settingsReady) {
      tagList.replaceChildren();
      return;
    }
    tagList.replaceChildren();
    editor.mounts.forEach((mount, index) => {
      const card = document.createElement("details");
      card.className = "tag-card";
      if (index === editor.mounts.length - 1) card.open = true;

      const summary = document.createElement("summary");
      summary.className = "tag-summary";

      const metaWrap = document.createElement("div");
      metaWrap.className = "tag-summary-meta";
      const title = document.createElement("div");
      title.className = "tag-title";
      const subtitle = document.createElement("div");
      subtitle.className = "tag-subtitle";
      metaWrap.append(title, subtitle);

      const syncMarker = () => {
        const current = editor.mounts[index];
        const id = current.marker_id;
        const size = Number(current.print_size_mm.toFixed(6));
        previewImg.src = `/api/apriltag/${id}.png`;
        preview.href = `/api/apriltag/${id}.pdf?size_mm=${encodeURIComponent(size)}`;
        previewImg.alt = `Fiducial marker ${id}`;
        title.textContent = isPresetId(id)
          ? `Fiducial marker ${id}`
          : `Fiducial marker ${id} (custom)`;
        subtitle.textContent = `${size} mm total · ${(size * 0.8).toFixed(0)} mm black`;
      };

      summary.append(metaWrap);

      const body = document.createElement("div");
      body.className = "tag-body";

      const picker = document.createElement("div"); picker.className = "tag-picker";
      const preview = document.createElement("a"); preview.className = "tag-preview";
      preview.target = "_blank"; preview.rel = "noopener"; preview.title = "Open printable PDF";
      const previewImg = document.createElement("img"); previewImg.width = previewImg.height = 64;
      preview.append(previewImg);
      const typeField = document.createElement("label"); typeField.className = "field tag-type-field";
      const typeLabel = document.createElement("span"); typeLabel.textContent = "Marker type";
      const typeSelect = document.createElement("select"); typeSelect.setAttribute("aria-label", "Marker type");
      typeSelect.disabled = configIsLocked();
      const used = usedMarkerIds(index);
      const ids = [...presetMarkerIds];
      if (!ids.includes(mount.marker_id)) ids.unshift(mount.marker_id);
      for (const id of ids) {
        const option = document.createElement("option"); option.value = String(id);
        option.textContent = `ID ${id}${isPresetId(id) ? "" : " (saved)"}`;
        option.disabled = used.has(id) && id !== mount.marker_id; typeSelect.append(option);
      }
      const uploadOption = document.createElement("option"); uploadOption.value = "upload";
      uploadOption.textContent = "Upload PNG…"; typeSelect.append(uploadOption);
      typeSelect.value = String(mount.marker_id);
      const uploadInput = makeFileInput(async file => {
        const markerId = await decodeUploadedPng(file);
        if (!assignMarkerId(index, markerId)) return;
        renderMountEditor(); schedulePersist();
      });
      typeSelect.addEventListener("change", () => {
        if (configIsLocked()) return;
        if (typeSelect.value === "upload") {
          typeSelect.value = String(editor.mounts[index].marker_id); uploadInput.click(); return;
        }
        if (!assignMarkerId(index, Number(typeSelect.value))) return;
        renderMountEditor(); schedulePersist();
      });
      typeField.append(typeLabel, typeSelect);
      picker.append(preview, typeField, uploadInput);

      const grid = document.createElement("div");
      grid.className = "tag-grid";
      const groups = [
        {title: "Print size", fields: FIELD_META.slice(0, 1)},
        {title: "Location (m)", fields: FIELD_META.slice(1, 4)},
        {title: "Rotation (°)", fields: FIELD_META.slice(4, 7)},
      ];
      groups.forEach(group => {
        const section = document.createElement("fieldset"); section.className = "tag-coordinate-group";
        const legend = document.createElement("legend"); legend.textContent = group.title;
        const row = document.createElement("div"); row.className = "tag-coordinate-row";
        group.fields.forEach((meta) => {
        const field = document.createElement("label");
        field.className = "tag-field";
        if (meta.field === "print_size_mm") field.classList.add("span-2");
        const label = document.createElement("span");
        label.textContent = meta.label;
        const control = makeNumInput(meta, mount[meta.field], (next) => {
          if (configIsLocked()) return;
          editor.mounts[index] = { ...editor.mounts[index], [meta.field]: next };
          syncMarker();
          schedulePersist();
        });
        field.append(label, control);
        if (meta.field !== "print_size_mm") {
          label.textContent = meta.label.replace(/ \(.*\)/, "");
          control.classList.add("coordinate-input");
        }
        row.append(field);
        });
        section.append(legend, row); grid.append(section);
      });

      const footer = document.createElement("div");
      footer.className = "tag-footer";
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn ghost tag-remove";
      removeBtn.textContent = "Remove";
      removeBtn.disabled = configIsLocked() || editor.mounts.length === 1;
      removeBtn.title =
        editor.mounts.length === 1 ? "Keep at least one fiducial marker" : "Remove this marker";
      removeBtn.addEventListener("click", () => {
        if (configIsLocked() || editor.mounts.length === 1) return;
        editor.mounts = editor.mounts.filter((_, i) => i !== index);
        renderMountEditor();
        schedulePersist();
      });
      footer.append(removeBtn);

      body.append(picker, grid, footer);
      card.append(summary, body);
      tagList.append(card);
      syncMarker();
    });
  }

  function syncLocalizationPanels() {
    fiducialPanel.classList.toggle("hidden", !fiducialEnabled.checked);
    $("markerPreferenceField").classList.toggle("hidden", !fiducialEnabled.checked);
    vpsPanel.classList.toggle("hidden", !vpsEnabled.checked);
  }

  function describeState(status, view) {
    const p = status.phase || "idle";
    switch (p) {
      case "checking":
        return { label: "Checking setup", detail: "", phase: "checking" };
      case "installing":
        return { label: "Installing", detail: "", phase: "installing" };
      case "starting":
        return { label: "Starting", detail: `Booting ${configuration.blueprint}…`, phase: "starting" };
      case "running":
        return { label: "Running", detail: `${configuration.blueprint} ARModule listening`, phase: "running" };
      case "stopping":
        return { label: "Stopping", detail: "Shutting down ARModule…", phase: "stopping" };
      case "error":
        return {
          label: "Error",
          detail: status.error || "ARModule failed — check the log",
          phase: "error",
        };
      default: {
        if (status.check_ok !== true || locNotSetup() || agentNotSetup() || view.hardwareMissing) {
          return { label: "Setup incomplete", detail: "", phase: "needs_setup" };
        }
        if (status.warning) {
          return { label: "Warning", detail: "", phase: "needs_setup" };
        }
        if (p === "idle") {
          return { label: "Idle", detail: "", phase: "idle" };
        }
        return { label: "ARModule Ready", detail: "", phase: "ready" };
      }
    }
  }

  function applyHeader(status, view) {
    const info = describeState(status || {}, view);
    stateValue.textContent = info.label;
    stateValue.dataset.phase = info.phase;
    stateDetail.textContent = info.detail;
    stateDetail.dataset.phase = info.phase;
    stateDetail.classList.toggle("hidden", !info.detail);
  }

  function renderControls() {
    const view = presentation();
    applyHeader(service.status, view);
    depsSummary.textContent = view.dependencyText;
    depsSummary.dataset.phase = view.dependencyPhase;
    syncInstallBanner(view);
    startBtn.disabled = view.startDisabled || !editor.settingsReady || !editor.robotProfileId || editor.requests.busy("start");
    stopBtn.disabled = false;
    stopBtn.textContent = view.stopLabel;
    stopBtn.classList.toggle("danger", view.stopDanger);
    setConfigLocked(view.locked);
  }

  function setupMode() {
    return document.querySelector('input[name="setupMode"]:checked')?.value || "existing";
  }

  function syncInstallBanner(view) {
    const ready = view.setupReady;
    const needsInstall = !ready;
    const cloning = setupMode() === "clone";
    const showInstall = needsInstall || cloning;

    installHint.textContent = needsInstall
      ? "A DimOS environment is required to continue."
      : "Download DimOS into the folder below. You can keep multiple installs.";
    installHint.classList.toggle("hidden", !showInstall);
    dimosRefField.classList.toggle("hidden", !cloning);
    installBtn.textContent = cloning ? "Download & install" : "Install";
    installBtn.classList.toggle("hidden", !showInstall);
    installBtn.disabled = view.installDisabled;
    installBanner.classList.toggle("needs-setup", needsInstall || view.hardwareMissing);

    const versionBits = [];
    if (service.status.dimos_version) versionBits.push(`DimOS ${service.status.dimos_version}`);
    if (service.status.dimos_ref) versionBits.push(service.status.dimos_ref);
    dimosVersionHint.textContent = versionBits.join(" · ");
    dimosVersionHint.classList.toggle("hidden", versionBits.length === 0);
  }

  function setText(el, value, fallback = "—") {
    el.textContent = value && String(value).trim() ? value : fallback;
  }

  function setHref(el, url, fallback = "—") {
    const text = url && String(url).trim() ? String(url).trim() : "";
    if (!text) {
      el.textContent = fallback;
      return;
    }
    const a = document.createElement("a");
    a.href = text;
    a.textContent = text;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    el.replaceChildren(a);
  }

  function applyConnectionStatus(status) {
    setText(hostIp, status.host_ip);
    const isWebxr = configuration.client === "webxr";
    $("hostIpRow").classList.remove("hidden");
    $("pinRow").classList.toggle("hidden", isWebxr);
    setText(pinValue, isWebxr ? null : status.pin);
    $("connectionSummaryLabel").textContent = "PIN";
    setText(pinSummary, status.pin);
    setHref($("urlSummary"), status.webxr_url, "Address available after Start");
    webxrNetworkRow.classList.toggle("hidden", !isWebxr);
    webxrHint.classList.toggle("hidden", !isWebxr);
    setHref(webxrNetwork, status.webxr_url);
  }

  function applyStatus(status) {
    service.observe(status);
    const environmentChanged = hardware.observeStatus(status);

    if (["starting", "running", "stopping"].includes(service.status.phase) && status.client) {
      configuration.selectClient(status.client);
      document.querySelectorAll("[data-client]").forEach(btn => btn.classList.toggle("active", btn.dataset.client === configuration.client));
    }
    applyConnectionStatus(status);

    if (status.warning) {
      warningText.textContent = status.warning;
      warningText.classList.remove("hidden");
    } else {
      warningText.classList.add("hidden");
    }

    if (status.error && service.status.phase !== "error") {
      errorText.textContent = status.error;
      errorText.classList.remove("hidden");
    } else {
      errorText.classList.add("hidden");
    }

    if (!editor.settingsReady && "openai_api_key" in status && document.activeElement !== apiKey) {
      apiKey.value = status.openai_api_key || "";
    }
    if (!editor.settingsReady && "multiset_client_id" in status && document.activeElement !== multisetClientId) {
      multisetClientId.value = status.multiset_client_id || "";
    }
    if (
      !editor.settingsReady && "multiset_client_secret" in status &&
      document.activeElement !== multisetClientSecret
    ) {
      multisetClientSecret.value = status.multiset_client_secret || "";
    }
    syncConfigCards(false);

    controlsCard.classList.remove("hidden");
    actionsBar.classList.remove("hidden");

    if (status.default_clone_dir && !cloneDir.value) {
      cloneDir.value = status.default_clone_dir;
    }
    if ((status.dimos_install_dir || status.dimos_python) && !dimosPython.value) {
      dimosPython.value = status.dimos_install_dir || status.dimos_python;
    }

    syncHardwareSetup();
    if (environmentChanged) { void refreshPlanner(); }

  }

  function syncSetupMode() {
    const existing = setupMode() === "existing";
    cloneDirField.classList.toggle("hidden", existing);
    dimosPythonField.classList.toggle("hidden", !existing);
    renderControls();
  }

  function initSplitter() {
    const stored = localStorage.getItem("launcher.panelWidth");
    if (stored) {
      const width = Number(stored);
      if (Number.isFinite(width) && width >= 280) {
        sidePanel.style.width = `${width}px`;
      }
    }

    let dragging = false;

    const onMove = (clientX) => {
      const min = 280;
      const max = Math.min(window.innerWidth * 0.7, window.innerWidth - 240);
      const width = Math.min(max, Math.max(min, clientX));
      sidePanel.style.width = `${width}px`;
      localStorage.setItem("launcher.panelWidth", String(Math.round(width)));
    };

    splitter.addEventListener("pointerdown", (ev) => {
      dragging = true;
      document.body.classList.add("resizing");
      splitter.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });

    splitter.addEventListener("pointermove", (ev) => {
      if (!dragging) return;
      onMove(ev.clientX);
    });

    const endDrag = (ev) => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("resizing");
      try {
        splitter.releasePointerCapture(ev.pointerId);
      } catch (_) {
        /* ignore */
      }
    };

    splitter.addEventListener("pointerup", endDrag);
    splitter.addEventListener("pointercancel", endDrag);

    splitter.addEventListener("keydown", (ev) => {
      const current = sidePanel.getBoundingClientRect().width;
      if (ev.key === "ArrowLeft") {
        onMove(current - 20);
        ev.preventDefault();
      } else if (ev.key === "ArrowRight") {
        onMove(current + 20);
        ev.preventDefault();
      }
    });
  }

  document.querySelectorAll("[data-client]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (configIsLocked()) return;
      document.querySelectorAll("[data-client]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      configuration.selectClient(btn.dataset.client);
      applyConnectionStatus(service.status);
    });
  });

  blueprintSelect.addEventListener("change", async () => {
    if (configIsLocked()) return;
    const request = editor.requests.begin("blueprint", () => JSON.stringify([environmentScope(), blueprintSelect.value]));
    const saved = await flushSettings();
    if (!request.current()) return;
    request.finish();
    if (editor.robotProfileId && !saved) {
      blueprintSelect.value = configuration.blueprint;
      return;
    }
    configuration.selectBlueprint(blueprintSelect.value);
    localStorage.setItem("dimos.blueprint", configuration.blueprint);
    applyBlueprintInfo();
  });

  fiducialEnabled.addEventListener("change", () => {
    syncLocalizationPanels();
    syncConfigCards();
    schedulePersist();
  });
  vpsEnabled.addEventListener("change", () => {
    syncLocalizationPanels();
    syncConfigCards();
    schedulePersist();
  });
  [vpsVendor, mapCode, multisetClientId, multisetClientSecret, logLevel].forEach((el) => {
    el.addEventListener("change", schedulePersist);
    el.addEventListener("blur", schedulePersist);
  });
  [mapCode, multisetClientId, multisetClientSecret].forEach((el) => {
    el.addEventListener("input", syncConfigCards);
  });
  logLevel.addEventListener("change", syncConfigCards);
  apiKey.addEventListener("input", syncConfigCards);

  restoreTagsBtn.addEventListener("click", () => {
    if (configIsLocked()) return;
    editor.mounts = [cloneMount(DEFAULT_MOUNT)];
    renderMountEditor();
    schedulePersist();
  });

  const addUploadInput = makeFileInput(async (file) => {
    const markerId = await decodeUploadedPng(file);
    if (usedMarkerIds().has(markerId)) {
      appendLog(`Fiducial marker ID ${markerId} is already in the list`);
      return;
    }
    const template = cloneMount(editor.mounts[0] || DEFAULT_MOUNT);
    template.marker_id = markerId;
    editor.mounts = [...editor.mounts, template];
    renderMountEditor();
    schedulePersist();
  });
  document.body.append(addUploadInput);

  addTagBtn.addEventListener("click", () => {
    if (configIsLocked()) return;
    const nextId = nextUnusedPresetId();
    if (nextId == null) {
      appendLog("All pre-built markers are in use. Upload a PNG to add another.");
      addUploadInput.click();
      return;
    }
    const template = cloneMount(editor.mounts[0] || DEFAULT_MOUNT);
    template.marker_id = nextId;
    editor.mounts = [...editor.mounts, template];
    renderMountEditor();
    schedulePersist();
  });

  document.querySelectorAll('input[name="setupMode"]').forEach((el) => {
    el.addEventListener("change", syncSetupMode);
  });
  syncSetupMode();
  initSplitter();
  applyBlueprintInfo();
  renderMountEditor();
  window.addEventListener("pageshow", applyBlueprintInfo);

  revealKey.addEventListener("click", () => {
    keyVisible = !keyVisible;
    apiKey.type = keyVisible ? "text" : "password";
    revealKey.textContent = keyVisible ? "Hide" : "Show";
  });
  revealMultiset.addEventListener("click", () => {
    multisetVisible = !multisetVisible;
    multisetClientSecret.type = multisetVisible ? "text" : "password";
    revealMultiset.textContent = multisetVisible ? "Hide" : "Show";
  });

  copyLogBtn.addEventListener("click", copyLog);
  clearLogBtn.addEventListener("click", clearLog);
  logFilterLevel.addEventListener("change", applyLogFilter);
  logFilterSource.addEventListener("change", applyLogFilter);

  dimosPython.addEventListener("click", async () => {
    if (editor.requests.busy("pythonPicker")) return;
    const request = editor.requests.begin("pythonPicker", () => JSON.stringify([environmentScope(), dimosPython.value]));
    try {
      const res = await fetch("/api/browse-dimos-install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: dimosPython.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!request.current()) return;
      if (!res.ok) {
        appendLog(`File chooser error: ${data.detail || res.statusText}`);
      } else if (data.path) {
        dimosPython.value = data.path;
      }
    } catch (err) {
      if (request.current()) appendLog(`File chooser error: ${err}`);
    } finally {
      request.finish();
    }
  });

  installBtn.addEventListener("click", async () => {
    const mode = setupMode();
    const body =
      mode === "existing"
        ? {
            mode: "existing",
            dimos_python: dimosPython.value.trim(),
          }
        : {
            mode: "clone",
            clone_dir: cloneDir.value.trim(),
            dimos_ref: dimosRef.value.trim() || "main",
          };
    body.manipulation = configuration.manipulation;
    installBtn.disabled = true;
    const revision = service.revision;
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        appendLog(`Setup error: ${data.detail || res.statusText}`);
        installBtn.disabled = false;
      }
      service.applyResponse(data, revision);
      void refreshCan(); void refreshPlanner();
    } catch (err) {
      appendLog(`Setup error: ${err}`);
      installBtn.disabled = false;
    }
  });

  apiKey.addEventListener("blur", () => {
    syncConfigCards();
    void saveSettings();
  });

  startBtn.addEventListener("click", async () => {
    startBtn.disabled = true;
    const selection = () => JSON.stringify([environmentScope(), configuration.client, editor.robotProfileId,
      $("robotSource").value, robotIp.value, $("replayPath").value, $("playbackSource").value]);
    const request = editor.requests.begin("start", selection);
    const saved = await saveSettings();
    if (!request.current()) return;
    if (!saved) {
      request.finish();
      renderControls();
      return;
    }
    await saveLauncherPreferences().catch(reportPreferencesError);
    if (!request.current()) return;
    const body = {
      blueprint: configuration.blueprint,
      client: configuration.client,
      profile_id: editor.robotProfileId,
      source: sourceRequest({ selection: $("robotSource").value, address: robotIp.value,
        replay: $("replayPath").value, playback: $("playbackSource").value,
        streams: preferences.replayStreams[configuration.replayRobot] || {} }),
    };
    const revision = service.revision;
    try {
      const res = await fetch("/api/armodule/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && request.current()) {
        const detail = data.detail;
        if (Array.isArray(detail?.devices)) {
          hardware.discoveredRobots[configuration.replayRobot] = detail.devices;
          renderSourceOptions();
        }
        if (detail?.suggest_simulated) { $("robotSource").value = "simulated"; syncSource(); }
        $("discoveryStatus").textContent = detail?.message || String(detail || res.statusText);
        appendLog(`Start error: ${detail?.message || detail || res.statusText}`);
        startBtn.disabled = false;
      }
      service.applyResponse(data, revision);
    } catch (err) {
      if (request.current()) appendLog(`Start error: ${err}`);
    } finally {
      request.finish();
      renderControls();
    }
  });

  stopBtn.addEventListener("click", async () => {
    const revision = service.revision;
    try {
      const res = await fetch(`/api/armodule/stop?force=${stopBtn.textContent === "Force stop"}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      service.applyResponse(data, revision);
    } catch (err) {
      appendLog(`Stop error: ${err}`);
    }
  });

  async function loadConfig() {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Could not load launcher settings");
      applySettingsPayload(await res.json());
      applyRobotProfile();
      void loadLauncherPreferences();
    } catch (error) {
      appendLog(`Settings load failed: ${error}`);
    }
  }

  async function loadDimosRefs() {
    const request = editor.requests.begin("refs", () => dimosRef.value);
    try {
      const res = await fetch("/api/dimos-refs");
      if (!res.ok) return;
      const data = await res.json();
      if (!request.current()) return;
      const refs = data.refs || ["main"];
      const selected = dimosRef.value || data.default || "main";
      dimosRef.replaceChildren(
        ...refs.map((ref) => {
          const option = document.createElement("option");
          option.value = ref;
          option.textContent = ref;
          return option;
        })
      );
      dimosRef.value = refs.includes(selected) ? selected : refs[0];
    } catch (_) {
      // Ref suggestions are optional; the selected value remains usable offline.
    } finally { request.finish(); }
  }

  loadConfig();
  loadDimosRefs();
  service.start();
  window.addEventListener("pagehide", () => service.stop());
  window.addEventListener("pageshow", event => { if (event.persisted) service.start(); });

  async function refreshRobotProfiles(preferredId = editor.robotProfileId) {
    const robot = configuration.robot;
    if (!robot) return;
    const request = editor.requests.begin("load", () => configuration.selectionRevision);
    let profiles;
    try { profiles = await profilesForRobot(fetch, robot, !configIsLocked(), request.current); }
    catch (error) {
      if (request.current()) appendLog(error.message);
      request.finish();
      return;
    }
    if (!request.current()) return;
    request.finish();
    const remembered = localStorage.getItem(`dimos.profile.${robot}`);
    editor.setProfiles(profiles, preferredId, remembered);
    if (!profiles.length) return;
    const select = $("robotProfileSelect");
    select.replaceChildren();
    for (const profile of editor.robotProfiles) {
      const option = document.createElement("option"); option.value = profile.id; option.textContent = profile.name; select.append(option);
    }
    localStorage.setItem(`dimos.profile.${robot}`, editor.robotProfileId);
    select.value = editor.robotProfileId;
    applyRobotProfile();
  }
  function applyRobotProfile() {
    const profile = editor.robotProfiles.find(p => p.id === editor.robotProfileId);
    if (!profile) return;
    $("robotProfileName").value = profile.name;
    const settings = profile.settings;
    fiducialEnabled.checked = settings.fiducial_marker;
    vpsEnabled.checked = settings.vps;
    mapCode.value = settings.map_code || "";
    editor.mounts = settings.mounts.map(cloneMount);
    Object.entries(policyInputs).forEach(([key, input]) => {
      input.value = String(settings[key] ?? policyDefaults[key]);
    });
    syncLocalizationPanels(); renderMountEditor(); syncConfigCards();
  }
  $("robotProfileSelect").addEventListener("change", async () => {
    if (configIsLocked()) return;
    const select = $("robotProfileSelect");
    const request = editor.requests.begin("switch", () => JSON.stringify([environmentScope(), select.value]));
    const saved = await flushSettings();
    if (!request.current()) return;
    request.finish();
    if (editor.robotProfileId && !saved) {
      select.value = editor.robotProfileId;
      return;
    }
    editor.robotProfileId = select.value;
    localStorage.setItem(`dimos.profile.${configuration.robot}`, editor.robotProfileId);
    applyRobotProfile();
  });
  function syncSource() {
    const simulated = $("robotSource").value === "simulated";

    $("replayRow").classList.toggle("hidden", !simulated);
    const robot = configuration.replayRobot;
    if (robot !== preferences.playbackRobot) {
      preferences.playbackRobot = robot;
      $("replayPath").value = preferences.values[replayPreferenceKey(robot)] || "";
      $("playbackSource").value = robot === "openyam" ? preferences.values.openyam_playback || "simulator" : "recording";
      $("replayStreams").replaceChildren();
      $("replayStatus").textContent = "";
    }
    $("playbackSource").querySelector('[value="simulator"]').hidden = !manipulationSelected();
    $("replayName").textContent = $("replayPath").value || (manipulationSelected() ? "Choose a recording" : "Default recording");
    $("editReplay").disabled = configIsLocked() || $("playbackSource").value !== "recording";

    syncHardwareSetup();
    if (manipulationSelected()) void refreshCan();
  }
  robotIp.addEventListener("change", () => { void saveLauncherPreferences().catch(reportPreferencesError); });
  $("robotSource").addEventListener("change", () => {
    preferences.values[`${configuration.replayRobot}_source`] = $("robotSource").value;
    syncSource();
    void saveLauncherPreferences().catch(reportPreferencesError);
  });
  function refreshRobotDiscovery() {
    return hardware.discover({
      enabled: !configIsLocked() && !!configuration.robot, robot: configuration.robot,
      auto: () => $("robotSource").value === "auto", scope: environmentScope, changed: syncHardwareSetup,
      progress: ({ phase, error }) => { $("discoveryStatus").textContent = phase === "checking" ? "Scanning…" : String(error); },
      received: data => {
        if (configuration.manipulation) void refreshCan();
        renderSourceOptions($("robotSource").value, "unavailable");
        $("discoveryStatus").textContent = data.devices.length
          ? `${data.devices.length} connection(s) found`
          : "No devices found. Check the connection and try Discover again.";
      },
    });
  }
  $("discoverWebrtc").addEventListener("click", refreshRobotDiscovery);
  $("refreshRobots").addEventListener("click", refreshRobotDiscovery);
  robotIp.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); $("saveRobotIp").click(); }
    if (event.key === "Escape") $("cancelRobotIp").click();
  });
  $("editConnection").addEventListener("click", () => { $("connectionEditor").classList.toggle("hidden"); robotIp.focus(); });
  $("cancelRobotIp").addEventListener("click", () => $("connectionEditor").classList.add("hidden"));
  $("saveRobotIp").addEventListener("click", () => {
    if (!robotIp.value.trim() || manipulationSelected()) { $("discoveryStatus").textContent = "Enter a Go2 IP address."; return; }
    renderSourceOptions("manual");
    $("connectionEditor").classList.add("hidden"); $("robotSource").dispatchEvent(new Event("change"));
  });
  $("editReplay").addEventListener("click", () => $("replayEditor").classList.toggle("hidden"));
  $("playbackSource").addEventListener("change", () => {
    if (manipulationSelected()) preferences.values.openyam_playback = $("playbackSource").value;
    syncSource(); void saveLauncherPreferences().catch(reportPreferencesError);
  });
  async function inspectReplay() {
    const request = preferences.requests.begin("inspect", replayScope);
    const path = $("replayPath").value.trim();
    if (!path) {
      request.finish();
      return;
    }
    const robot = configuration.replayRobot;
    $("replayStatus").textContent = "Checking recording…";
    try {
      const response = await fetch("/api/replay/inspect", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({path, robot: robot === "go2" ? "unitree_go2" : robot, streams: preferences.replayStreams[robot] || {}})});
      const data = await response.json();
      if (!request.current()) return;
      if (!response.ok) throw new Error(data.detail || "Invalid recording");
      preferences.replayStreams[robot] = data.streams;
      $("replayStreams").replaceChildren();
      for (const [role, choices] of Object.entries(data.candidates)) {
        if (choices.length < 2) continue;
        const label = document.createElement("label"); label.className = "field"; label.textContent = `${role} stream`;
        const select = document.createElement("select"); select.setAttribute("aria-label", `${role} stream`);
        const empty = document.createElement("option"); empty.value = ""; empty.textContent = "Choose stream"; select.append(empty);
        for (const name of choices) { const option = document.createElement("option"); option.value = name; option.textContent = name; select.append(option); }
        select.value = data.streams[role] || "";
        select.addEventListener("change", () => { if (select.value) preferences.replayStreams[robot][role] = select.value; else delete preferences.replayStreams[robot][role]; void inspectReplay(); });
        label.append(select); $("replayStreams").append(label);
      }
      $("replayStatus").textContent = data.needs_selection ? "Choose streams before starting." : "Recording ready · read-only · 1×";
      void saveLauncherPreferences().catch(reportPreferencesError);
    } catch (error) {
      if (request.current()) $("replayStatus").textContent = String(error);
    } finally { request.finish(); }
  }
  $("replayPath").addEventListener("change", () => {
    const robot = configuration.replayRobot;
    const path = $("replayPath").value.trim();
    if (path === (preferences.values[replayPreferenceKey(robot)] || "")) return;
    preferences.replayStreams[robot] = {};
    preferences.values[replayPreferenceKey(robot)] = path;
    syncSource(); void saveLauncherPreferences().catch(reportPreferencesError); void inspectReplay();
  });
  $("browseReplay").addEventListener("click", async () => {
    if (configIsLocked()) return;
    const request = preferences.requests.begin("browse", replayScope);
    try {
      const response = await fetch("/api/browse-replay", { method: "POST" });
      const data = await response.json();
      if (!request.current()) return;
      if (!response.ok) throw new Error(data.detail || "Could not select recording");
      if (data.path) { $("replayPath").value = data.path; $("replayPath").dispatchEvent(new Event("change")); }
    } catch (error) {
      if (request.current()) $("discoveryStatus").textContent = String(error);
    } finally { request.finish(); }
  });
  $("defaultReplay").addEventListener("click", () => {
    $("replayPath").value = ""; preferences.values[replayPreferenceKey(preferences.playbackRobot)] = "";
    preferences.replayStreams[preferences.playbackRobot] = {};
    preferences.requests.cancel("inspect");
    $("replayStreams").replaceChildren(); $("replayStatus").textContent = "";
    syncSource(); void saveLauncherPreferences().catch(reportPreferencesError);
  });
  async function loadLauncherPreferences() {
    try {
      const response = await fetch("/api/launcher-preferences");
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not load saved preferences");
      if (configIsLocked() || !preferences.hydrate(data)) return;
      if (typeof data.manual_ip === "string") robotIp.value = data.manual_ip;
      const value = preferences.values[`${configuration.replayRobot}_source`] || "auto";
      renderSourceOptions(value);
      syncSource();
      if (value.startsWith("device:")) void refreshRobotDiscovery();
    } catch (error) {
      if (!preferences.edited) appendLog(`Could not load launcher preferences: ${error}`);
    }
  }
  function reportPreferencesError(error) { appendLog(`Could not save launcher preferences: ${error}`); }
  function saveLauncherPreferences() {
    preferences.values[`${configuration.replayRobot}_source`] = $("robotSource").value;
    return preferences.save(body => fetch("/api/launcher-preferences", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body,
    }), robotIp.value.trim());
  }
  $("profileEdit").addEventListener("click", () => {
    if (configIsLocked()) return;
    const editor = $("profileEditor");
    editor.classList.toggle("hidden");
    $("profileEdit").setAttribute("aria-expanded", String(!editor.classList.contains("hidden")));
    if (!editor.classList.contains("hidden")) $("robotProfileName").focus();
  });
  const closeProfileEditor = () => { $("robotProfileName").value = editor.robotProfiles.find(profile => profile.id === editor.robotProfileId)?.name || ""; $("deleteProfileConfirm").classList.add("hidden"); $("profileEditor").classList.add("hidden"); $("profileEdit").setAttribute("aria-expanded", "false"); };
  $("profileDone").addEventListener("click", closeProfileEditor);
  document.addEventListener("click", event => {
    if (!$("profileEditor").contains(event.target) && !$("profileEdit").contains(event.target)) closeProfileEditor();
  });
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeProfileEditor(); });
  $("cancelProfileName").addEventListener("click", () => { applyRobotProfile(); closeProfileEditor(); });
  $("robotProfileName").addEventListener("keydown", event => { if (event.key === "Enter") $("saveProfileName").click(); });
  function profileScope() {
    return JSON.stringify([configuration.blueprint, editor.robotProfileId]);
  }
  $("saveProfileName").addEventListener("click", async () => {
    if (configIsLocked() || !editor.robotProfileId || editor.requests.busy("rename")) return;
    const id = editor.robotProfileId;
    const request = editor.requests.begin("rename", profileScope);
    try {
      const response = await fetch(`/api/robot-profiles/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: $("robotProfileName").value }),
      });
      if (!request.current()) return;
      if (!response.ok) throw new Error("Could not save profile name. Use 1–80 characters.");
      $("profileError").classList.add("hidden");
      await refreshRobotProfiles();
      if (request.current()) closeProfileEditor();
    } catch (error) {
      if (!request.current()) return;
      $("profileError").textContent = String(error);
      $("profileError").classList.remove("hidden");
    } finally { request.finish(); }
  });
  async function createRobotProfile() {
    if (configIsLocked() || editor.requests.busy("create")) return;
    const robot = configuration.robot;
    const request = editor.requests.begin("create", environmentScope);
    try {
      const saved = await saveSettings();
      if (!request.current() || !saved) return;
      const response = await fetch("/api/robot-profiles", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ robot, source_id: null }),
      });
      const created = await response.json();
      if (!request.current()) return;
      if (!response.ok) throw new Error("Profile creation failed");
      await refreshRobotProfiles(created.id);
    } catch (error) {
      if (request.current()) appendLog(String(error));
    } finally { request.finish(); }
  }
  $("newRobotProfile").addEventListener("click", createRobotProfile);
  $("deleteRobotProfile").addEventListener("click", () => $("deleteProfileConfirm").classList.remove("hidden"));
  $("confirmDeleteProfile").addEventListener("click", async () => {
    if (configIsLocked() || !editor.robotProfileId || editor.requests.busy("delete")) return;
    const id = editor.robotProfileId;
    const request = editor.requests.begin("delete", profileScope);
    try {
      const response = await fetch(`/api/robot-profiles/${id}`, { method: "DELETE" });
      if (!request.current()) return;
      if (!response.ok) throw new Error("Profile deletion failed");
      $("deleteProfileConfirm").classList.add("hidden");
      await refreshRobotProfiles(null);
    } catch (error) {
      if (request.current()) appendLog(String(error));
    } finally { request.finish(); }
  });
})();
