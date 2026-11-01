(() => {
  const $ = (id) => document.getElementById(id);

  const stateValue = $("stateValue");
  const stateDetail = $("stateDetail");
  const hostIp = $("hostIp");
  const hostIpSummary = $("hostIpSummary");
  const pinValue = $("pin");
  const pinSummary = $("pinSummary");
  const webxrNetwork = $("webxrNetwork");
  const webxrNetworkRow = $("webxrNetworkRow");
  const webxrHint = $("webxrHint");
  const robotValue = $("robotValue");
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
  const mixedPolicyBox = $("mixedPolicyBox");
  const blueprintSelect = $("blueprintSelect");
  const blueprintInfo = $("blueprintInfo");
  const agentConfig = $("agentConfig");
  const locCard = $("locCard");
  const locSummary = $("locSummary");
  const agentSummary = $("agentSummary");
  const logCard = $("logCard");
  const logSummary = $("logSummary");
  const logLevel = $("logLevel");
  const fiducialPanel = $("fiducialPanel");
  const vpsPanel = $("vpsPanel");
  const vpsVendor = $("vpsVendor");
  const mapCode = $("mapCode");
  const multisetClientId = $("multisetClientId");
  const multisetClientSecret = $("multisetClientSecret");
  const revealMultiset = $("revealMultiset");

  let client = "webxr";
  let blueprint = "unitree_go2_ar";
  let robotProfileId = null;
  let robotProfiles = [];
  let profileLoadGeneration = 0;
  let phase = "idle";
  let checkOk = null;
  let lastStatus = {};
  let canStatus = { ready: false, state: "checking", message: "Checking can0…" };
  let plannerStatus = { ready: false, state: "checking", message: "Checking manipulation dependencies…" };
  let resolvedCan = "can0";
  let discoveryGeneration = 0;
  let discoveryPending = false;
  let go2DiscoveryState = {text: "Not scanned", phase: ""};
  let canCheckPending = false;
  let plannerCheckPending = false;
  let canSetupPending = false;
  let plannerPython = null;
  let keyVisible = false;
  let multisetVisible = false;
  const MAX_LOG_LINES = 5000;
  const logLines = [];
  const pendingLines = [];
  let frameHandle = null;

  const DEFAULT_MOUNT = {
    marker_id: 0,
    print_size_mm: 70,
    forward_m: 0.18,
    lateral_m: 0.0,
    up_m: 0.06,
    yaw_deg: -90,
    pitch_deg: -15,
  };

  let presetMarkerIds = [0, 1, 2];
  let mounts = [{ ...DEFAULT_MOUNT }];
  let settingsReady = false;
  let persistTimer = null;
  let configLocked = false;

  const FIELD_META = [
    { field: "print_size_mm", label: "Print size (mm)", step: 1, min: 20, max: 200 },
    { field: "forward_m", label: "Forward (m)", step: 0.01 },
    { field: "lateral_m", label: "Lateral (m)", step: 0.01 },
    { field: "up_m", label: "Up (m)", step: 0.01 },
    { field: "yaw_deg", label: "Yaw (°)", step: 1 },
    { field: "pitch_deg", label: "Pitch (°)", step: 1 },
    { field: "roll_deg", label: "Roll (°)", step: 1 },
  ];

  const BLUEPRINTS = {
    openyam_ar_planner: { info: "OpenYAM · manipulation: plan/review/execute or grab the end effector to follow." },
    unitree_go2_ar: {
      info: "Unitree Go2 with ARModule\nManual Mode: place navigation goals from the headset.",
    },
    unitree_go2_ar_agentic: {
      info: "Unitree Go2 with ARModule\nManual Mode: place navigation goals from the headset.\nAgent Mode: voice commands via LLM and MCP (API key required)",
      agent: true,
    },
  };

  const savedBlueprint = localStorage.getItem("dimos.blueprint");
  if (savedBlueprint && BLUEPRINTS[savedBlueprint]) blueprintSelect.value = savedBlueprint;

  const LOG_LEVELS = ["DEBUG", "INFO", "WARNING", "ERROR"];

  let playbackRobot = null;
  const replayStreams = {};
  let replayInspectionGeneration = 0;
  let preferencesEdited = false;
  let preferencesSave = Promise.resolve();
  const discoveredRobots = {go2: [], openyam: []};
  function applyBlueprintInfo() {
    blueprint = blueprintSelect.value;
    const spec = BLUEPRINTS[blueprint] || {};
    blueprintInfo.textContent = spec.info || "";
    const manipulation = blueprint === "openyam_ar_planner";



    const robotKey = manipulation ? "openyam" : "go2";
    const sourceSelect = $("robotSource");
    sourceSelect.querySelectorAll('[value^="device:"], [value="manual"]').forEach(option => option.remove());
    for (const device of discoveredRobots[robotKey]) {
      const option = document.createElement("option"); option.value = `device:${device.id}`; option.textContent = device.label;
      sourceSelect.insertBefore(option, sourceSelect.querySelector('[value="simulated"]'));
    }
    if (!manipulation && robotIp.value.trim()) {
      const option = document.createElement("option"); option.value = "manual"; option.textContent = `${robotIp.value.trim()} (manual)`;
      sourceSelect.insertBefore(option, sourceSelect.querySelector('[value="simulated"]'));
    }
    $("editConnection").disabled = configLocked || manipulation;
    $("connectionEditor").classList.add("hidden");
    const rememberedSource = localStorage.getItem(`dimos.source.${manipulation ? "openyam" : "go2"}`) || "auto";
    if ((rememberedSource.startsWith("device:") || rememberedSource === "manual") && ![...$("robotSource").options].some(option => option.value === rememberedSource)) {
      const option = document.createElement("option"); option.value = rememberedSource; option.textContent = option.value === "manual" ? `${robotIp.value.trim()} (manual)` : `${option.value.slice(7)} (saved)`; $("robotSource").insertBefore(option, $("robotSource").querySelector('[value="simulated"]'));
    }
    $("robotSource").value = rememberedSource;
    syncSource();


    document.querySelectorAll("[data-client=specs]").forEach(button => { button.disabled = false; });
    if (settingsReady) {
      void refreshRobotProfiles();
      if (rememberedSource.startsWith("device:")) void refreshRobotDiscovery();
    }
    agentConfig.classList.toggle("hidden", !spec.agent);
    syncConfigCards();
    syncHardwareSetup();
    if (manipulation) { void refreshCan(); void refreshPlanner(); }
  }

  function manipulationSelected() { return blueprint === "openyam_ar_planner"; }
  function canRequired() {
    return manipulationSelected() && !($("robotSource").value === "simulated" && manipulationSelected()) && canStatus.state !== "not_required";
  }
  function hardwareNotSetup() {
    return manipulationSelected() && (!plannerStatus.ready || (canRequired() && !canStatus.ready));
  }
  function syncHardwareSetup() {
    const selected = manipulationSelected();
    const mock = ($("robotSource").value === "simulated" && manipulationSelected());
    const card = $("canCard");
    card.classList.toggle("hidden", !selected);
    $("webrtcCard").classList.toggle("hidden", selected);
    const simulated = $("robotSource").value === "simulated";
    $("webrtcSummary").textContent = simulated ? "Not required" : go2DiscoveryState.text;
    $("webrtcSummary").dataset.phase = simulated ? "" : go2DiscoveryState.phase;
    $("discoverWebrtc").disabled = configLocked || simulated || discoveryPending || checkOk !== true;
    $("discoverWebrtc").textContent = discoveryPending ? "Scanning…" : "Discover";
    const missing = canRequired() && !canStatus.ready;
    card.classList.toggle("needs-setup", missing);
    const canNotRequired = mock || canStatus.state === "not_required";
    const canPhase = canNotRequired ? "" : canStatus.state === "error" ? "error" : canStatus.ready ? "ready" : canStatus.state === "checking" ? "checking" : "needs_setup";
    $("canSummary").textContent = canNotRequired ? "Not required" : canStatus.ready ? "Ready · 1 Mbit/s" : canStatus.state === "checking" ? "Checking…" : canStatus.state === "error" ? "Error" : "Setup needed";
    $("canSummary").dataset.phase = canPhase;
    $("canStatus").dataset.phase = canPhase;
    $("canStatus").classList.toggle("hidden", !canNotRequired && canStatus.ready);
    $("canStatus").textContent = mock ? "Not required for simulated connection." : canStatus.message;
    const settingUp = canSetupPending || lastStatus.can_setup_running || canStatus.setting_up;
    $("canSetupBtn").textContent = settingUp ? "Setting up…" : "Set up CAN";
    $("canSetupBtn").disabled = !selected || mock || configLocked || settingUp || canNotRequired || checkOk !== true || ["checking", "installing"].includes(phase);
    $("plannerStatus").classList.toggle("hidden", !selected);
    $("plannerStatus").textContent = plannerStatus.message || "Checking manipulation dependencies…";
    $("plannerStatus").dataset.phase = plannerStatus.state === "error" ? "error" : plannerStatus.ready ? "ready" : "checking";
    const deps = describeDeps(lastStatus);
    depsSummary.textContent = deps.text;
    depsSummary.dataset.phase = deps.phase;
    syncInstallBanner();
    applyHeader(lastStatus);
    startBtn.disabled = configLocked || ["checking", "installing"].includes(phase) || checkOk !== true || settingUp || hardwareNotSetup();
  }
  async function refreshCan() {
    if (!manipulationSelected() || canCheckPending || canSetupPending || document.hidden) return;
    canCheckPending = true;
    try {
      const response = await fetch(`/api/can/status?interface=${encodeURIComponent($("robotSource").value.startsWith("device:") ? $("robotSource").value.slice(7) : resolvedCan)}`);
      if (!response.ok) throw new Error("CAN status check failed");
      canStatus = await response.json();
    } catch (error) { canStatus = {ready: false, state: "error", message: String(error)}; }
    finally { canCheckPending = false; syncHardwareSetup(); }
  }
  async function refreshPlanner() {
    if (!manipulationSelected() || plannerCheckPending || document.hidden) return;
    plannerCheckPending = true;
    try {
      const response = await fetch("/api/planner/status");
      if (!response.ok) throw new Error("Planner dependency check failed");
      plannerStatus = await response.json();
    } catch (error) { plannerStatus = {ready: false, state: "error", message: String(error)}; }
    finally { plannerCheckPending = false; syncHardwareSetup(); }
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { void refreshCan(); void refreshPlanner(); } });
  setInterval(() => { void refreshCan(); void refreshPlanner(); }, 5000);
  $("canSetupBtn").addEventListener("click", async () => {
    if (canSetupPending || configLocked) return;
    const result = $("canSetupResult");
    result.classList.remove("hidden");
    result.textContent = "Checking CAN configuration…";
    result.dataset.phase = "checking";
    canSetupPending = true; syncHardwareSetup();
    try {
      const response = await fetch(`/api/can/setup?interface=${encodeURIComponent($("robotSource").value.startsWith("device:") ? $("robotSource").value.slice(7) : resolvedCan)}`, {method: "POST"});
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "CAN setup failed");
      canStatus = data;
      result.textContent = `Already set up on ${data.interface || resolvedCan}`;
      result.dataset.phase = "ready";
    } catch (error) {
      result.textContent = `CAN setup failed: ${error}`;
      result.dataset.phase = "error";
      appendLog(`CAN setup: ${error}`);
      canStatus = {ready: false, state: "error", message: String(error)};
    } finally { canSetupPending = false; syncHardwareSetup(); }
  });

  function fiducialConfigured() {
    return mounts.length > 0;
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
    return Boolean(BLUEPRINTS[blueprint]?.agent) && !apiKey.value.trim();
  }

  function syncConfigCards() {
    const locMissing = locNotSetup();
    locCard.classList.toggle("needs-setup", locMissing);
    locSummary.textContent = locMissing ? "incomplete" : "";
    locSummary.dataset.phase = locMissing ? "needs_setup" : "";

    const agentMissing = agentNotSetup();
    agentConfig.classList.toggle("needs-setup", agentMissing);
    agentSummary.textContent = agentMissing ? "incomplete" : "";
    agentSummary.dataset.phase = agentMissing ? "needs_setup" : "";

    logSummary.textContent = logLevel.value || "INFO";
    logSummary.dataset.phase = "";
    applyHeader(lastStatus);
  }

  function cloneMount(raw) {
    const src = raw || DEFAULT_MOUNT;
    return {
      marker_id: Number(src.marker_id) || 0,
      print_size_mm: Number(src.print_size_mm) > 0 ? Number(src.print_size_mm) : 70,
      forward_m: Number(src.forward_m) || 0,
      lateral_m: Number(src.lateral_m) || 0,
      up_m: Number(src.up_m) || 0,
      yaw_deg: Number(src.yaw_deg) || 0,
      pitch_deg: Number(src.pitch_deg) || 0,
      roll_deg: Number(src.roll_deg) || 0,
    };
  }

  function schedulePersist() {
    if (configLocked) return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      void saveSettings();
    }, 400);
  }

  function settingsBody() {
    return {
      profile_id: robotProfileId,
      openai_api_key: apiKey.value.trim() || null,
      multiset_client_id: multisetClientId.value.trim() || null,
      multiset_client_secret: multisetClientSecret.value.trim() || null,
      fiducial_marker: fiducialEnabled.checked,
      vps: vpsEnabled.checked,
      vps_vendor: vpsVendor.value || "multiset",
      map_code: mapCode.value.trim() || null,
      mounts,
      dimos_log_level: logLevel.value || "INFO",
    };
  }

  async function saveSettings() {
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsBody()),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        appendLog(`Settings save failed: ${data.detail || res.statusText}`);
        return null;
      }
      if (data.phase) applyStatus(data);
      return data;
    } catch (err) {
      appendLog(`Settings save failed: ${err}`);
      return null;
    }
  }

  function applySettingsPayload(data) {
    if (data.defaults?.mounts?.[0]) {
      Object.assign(DEFAULT_MOUNT, cloneMount(data.defaults.mounts[0]));
    }
    if (Array.isArray(data.defaults?.preset_marker_ids) && data.defaults.preset_marker_ids.length) {
      presetMarkerIds = [0, 1, 2];
    }
    const loaded = Array.isArray(data.mounts) && data.mounts.length ? data.mounts : [DEFAULT_MOUNT];
    mounts = loaded.map((item) => cloneMount(item));
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
      const level = String(data.dimos_log_level || "INFO").toUpperCase();
      logLevel.value = LOG_LEVELS.includes(level) ? level : "INFO";
    }
    if (document.activeElement !== multisetClientId && "multiset_client_id" in data) {
      multisetClientId.value = data.multiset_client_id || "";
    }
    if (document.activeElement !== multisetClientSecret && "multiset_client_secret" in data) {
      multisetClientSecret.value = data.multiset_client_secret || "";
    }
    settingsReady = true;
    syncLocalizationPanels();
    renderMountEditor();
    applyBlueprintInfo();
  }

  function setConfigLocked(locked) {
    configLocked = locked;
    controlsCard.classList.toggle("locked", locked);
    document.querySelectorAll("[data-client]").forEach((btn) => {
      btn.disabled = locked;
    });
    blueprintSelect.disabled = locked;
    for (const id of ["robotProfileSelect", "robotProfileName", "newRobotProfile", "deleteRobotProfile", "robotSource", "refreshRobots", "playbackSource", "editConnection", "saveRobotIp", "cancelRobotIp", "robotIp", "editReplay", "replayPath", "browseReplay", "defaultReplay", "profileEdit", "profileDone", "saveProfileName", "cancelProfileName", "confirmDeleteProfile"]) { const control = $(id); if (control) control.disabled = locked; }
    document.querySelectorAll("[data-client=specs]").forEach(button => { button.disabled = locked; });
    apiKey.disabled = locked;
    revealKey.disabled = locked;
    robotIp.disabled = locked;
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
    input.disabled = configLocked;

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
      if (meta.field === "print_size_mm" && n <= 0) n = 70;
      input.value = String(n);
      onChange(n);
    };

    dec.addEventListener("click", () => {
      if (configLocked) return;
      commit(Number(input.value) - meta.step);
    });
    inc.addEventListener("click", () => {
      if (configLocked) return;
      commit(Number(input.value) + meta.step);
    });
    input.addEventListener("change", () => commit(input.value));

    dec.disabled = configLocked;
    inc.disabled = configLocked;
    wrap.append(dec, input, inc);
    return wrap;
  }

  function usedMarkerIds(exceptIndex) {
    return new Set(
      mounts
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
    mounts[index] = { ...mounts[index], marker_id: markerId };
    return true;
  }

  function makeFileInput(onFile) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png";
    input.hidden = true;
    input.disabled = configLocked;
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      input.value = "";
      if (!file || configLocked) return;
      try {
        await onFile(file);
      } catch (err) {
        appendLog(`PNG upload failed: ${err.message || err}`);
      }
    });
    return input;
  }

  function renderMountEditor() {
    if (!settingsReady) {
      tagList.replaceChildren();
      return;
    }
    tagList.replaceChildren();
    mounts.forEach((mount, index) => {
      const card = document.createElement("details");
      card.className = "tag-card";
      if (index === mounts.length - 1) card.open = true;

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
        const current = mounts[index];
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
      typeSelect.disabled = configLocked;
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
        if (configLocked) return;
        if (typeSelect.value === "upload") {
          typeSelect.value = String(mounts[index].marker_id); uploadInput.click(); return;
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
          if (configLocked) return;
          mounts[index] = { ...mounts[index], [meta.field]: next };
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
      removeBtn.disabled = configLocked || mounts.length === 1;
      removeBtn.title =
        mounts.length === 1 ? "Keep at least one fiducial marker" : "Remove this marker";
      removeBtn.addEventListener("click", () => {
        if (configLocked || mounts.length === 1) return;
        mounts = mounts.filter((_, i) => i !== index);
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
    vpsPanel.classList.toggle("hidden", !vpsEnabled.checked);
    mixedPolicyBox.classList.toggle(
      "hidden",
      !(fiducialEnabled.checked && vpsEnabled.checked)
    );
  }

  function describeState(status) {
    const p = status.phase || "idle";
    switch (p) {
      case "checking":
        return { label: "Checking setup", detail: "", phase: "checking" };
      case "installing":
        return { label: "Installing", detail: "", phase: "installing" };
      case "starting":
        return { label: "Starting", detail: `Booting ${blueprint}…`, phase: "starting" };
      case "running":
        return { label: "Running", detail: `${blueprint} ARModule listening`, phase: "running" };
      case "stopping":
        return { label: "Stopping", detail: "Shutting down ARModule…", phase: "stopping" };
      case "error":
        return {
          label: "Error",
          detail: status.error || "ARModule failed — check the log",
          phase: "error",
        };
      default: {
        if (status.check_ok !== true || locNotSetup() || agentNotSetup() || hardwareNotSetup()) {
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

  function applyHeader(status) {
    const info = describeState(status || {});
    stateValue.textContent = info.label;
    stateValue.dataset.phase = info.phase;
    stateDetail.textContent = info.detail;
    stateDetail.dataset.phase = info.phase;
    stateDetail.classList.toggle("hidden", !info.detail);
  }

  function describeDeps(status) {
    const p = status.phase || "idle";
    if (p === "installing") {
      return { text: "installing…", phase: "installing" };
    }
    if (p === "checking") {
      return { text: "checking…", phase: "checking" };
    }
    if (status.check_ok === true && !hardwareNotSetup()) {
      return { text: "", phase: "" };
    }
    return { text: "incomplete", phase: "needs_setup" };
  }

  function setupMode() {
    return document.querySelector('input[name="setupMode"]:checked')?.value || "existing";
  }

  function syncInstallBanner() {
    const ready = checkOk === true && (!manipulationSelected() || plannerStatus.ready);
    const busy =
      phase === "checking" ||
      phase === "installing" ||
      phase === "starting" ||
      phase === "stopping";
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
    installBtn.disabled = busy || configLocked || canSetupPending || lastStatus.can_setup_running;
    installBanner.classList.toggle("needs-setup", needsInstall || hardwareNotSetup());

    const versionBits = [];
    if (lastStatus.dimos_version) versionBits.push(`DimOS ${lastStatus.dimos_version}`);
    if (lastStatus.dimos_ref) versionBits.push(lastStatus.dimos_ref);
    dimosVersionHint.textContent = versionBits.join(" · ");
    dimosVersionHint.classList.toggle("hidden", versionBits.length === 0);
  }

  const ANSI_RE = /\u001b\[([0-9;]*)m/g;

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function ansiToHtml(line) {
    let html = "";
    let last = 0;
    let classes = new Set();
    ANSI_RE.lastIndex = 0;
    let match;
    while ((match = ANSI_RE.exec(line)) !== null) {
      if (match.index > last) {
        const chunk = escapeHtml(line.slice(last, match.index));
        if (classes.size) {
          html += `<span class="${[...classes].join(" ")}">${chunk}</span>`;
        } else {
          html += chunk;
        }
      }
      last = match.index + match[0].length;
      const codes = match[1] === "" ? ["0"] : match[1].split(";");
      for (const code of codes) {
        if (code === "0" || code === "") {
          classes = new Set();
        } else if (code === "1") {
          classes.add("ansi-bold");
        } else if (code === "2") {
          classes.add("ansi-dim");
        } else if (code === "22") {
          classes.delete("ansi-bold");
          classes.delete("ansi-dim");
        } else if (code === "39") {
          for (const c of [...classes]) {
            if (c.startsWith("ansi-fg-")) classes.delete(c);
          }
        } else if (/^(3[0-7]|9[0-7])$/.test(code)) {
          for (const c of [...classes]) {
            if (c.startsWith("ansi-fg-")) classes.delete(c);
          }
          classes.add(`ansi-fg-${code}`);
        }
      }
    }
    if (last < line.length) {
      const chunk = escapeHtml(line.slice(last));
      if (classes.size) {
        html += `<span class="${[...classes].join(" ")}">${chunk}</span>`;
      } else {
        html += chunk;
      }
    }
    return html;
  }

  function stripAnsi(text) {
    return text.replace(ANSI_RE, "");
  }

  const LEVEL_RANK = { debug: 0, info: 1, warning: 2, error: 3 };
  const LEVEL_RE = /(?:\[\s*|\b)(debug|dbg|info|inf|warning|warn|wrn|error|err|critical|exception)\b(?:\s*\])?/i;
  const AR_RE = /armodule|dimos[./]ar\b|ARModule/i;
  let lastLevel = "info";
  let lastAr = false;

  function classifyLine(line) {
    const plain = stripAnsi(line);
    const m = LEVEL_RE.exec(plain.slice(0, 80));
    if (m) {
      const key = m[1].toLowerCase();
      lastLevel = key.startsWith("d")
        ? "debug"
        : key.startsWith("i")
          ? "info"
          : key.startsWith("w")
            ? "warning"
            : "error";
      lastAr = AR_RE.test(plain);
    } else if (AR_RE.test(plain)) {
      lastAr = true;
    }
    return { level: lastLevel, ar: lastAr };
  }

  function lineVisible(entry) {
    const min = LEVEL_RANK[logFilterLevel.value] ?? 0;
    if (LEVEL_RANK[entry.level] < min) return false;
    return !(logFilterSource.value === "ar" && !entry.ar);
  }

  function makeLogLineEl(entry) {
    const el = document.createElement("div");
    el.className = "log-line";
    el.innerHTML = ansiToHtml(entry.line);
    el.hidden = !lineVisible(entry);
    entry.el = el;
    return el;
  }

  function applyLogFilter() {
    for (const entry of logLines) {
      if (entry.el) entry.el.hidden = !lineVisible(entry);
    }
    logEl.scrollTop = logEl.scrollHeight;
  }

  function flushLog() {
    frameHandle = null;
    if (!pendingLines.length) return;
    const nearBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 48;
    const fragment = document.createDocumentFragment();
    for (const line of pendingLines) {
      const entry = { line, ...classifyLine(line), el: null };
      fragment.appendChild(makeLogLineEl(entry));
      logLines.push(entry);
    }
    pendingLines.length = 0;
    logEl.appendChild(fragment);

    const excess = logLines.length - MAX_LOG_LINES;
    if (excess > 0) {
      for (let i = 0; i < excess; i++) {
        const first = logEl.firstElementChild;
        if (first) logEl.removeChild(first);
      }
      logLines.splice(0, excess);
    }

    if (nearBottom) {
      logEl.scrollTop = logEl.scrollHeight;
    }
  }

  function appendLog(line) {
    pendingLines.push(line);
    if (frameHandle === null) {
      frameHandle = requestAnimationFrame(flushLog);
    }
  }

  function clearLog() {
    if (frameHandle !== null) {
      cancelAnimationFrame(frameHandle);
      frameHandle = null;
    }
    pendingLines.length = 0;
    logLines.length = 0;
    logEl.textContent = "";
  }

  async function copyLog() {
    const text = logLines
      .filter(lineVisible)
      .map((entry) => stripAnsi(entry.line))
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      const prev = copyLogBtn.textContent;
      copyLogBtn.textContent = "Copied";
      setTimeout(() => {
        copyLogBtn.textContent = prev;
      }, 1200);
    } catch (err) {
      appendLog(`Copy failed: ${err}`);
    }
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

  function displayRobotIp(value) {
    if (!value || !String(value).trim()) return "";
    const raw = String(value).trim();
    if (raw === "fake" || raw === "simulated" || raw === "mock" || raw === "replay") {
      return "simulated";
    }
    return raw;
  }

  function applyConnectionStatus(status) {
    setText(hostIp, status.host_ip);
    setText(hostIpSummary, status.host_ip);
    const isWebxr = client === "webxr";
    $("hostIpRow").classList.toggle("hidden", isWebxr);
    $("hostIpSummaryLabel").classList.toggle("hidden", isWebxr);
    hostIpSummary.classList.toggle("hidden", isWebxr);
    $("pinRow").classList.toggle("hidden", isWebxr);
    setText(pinValue, isWebxr ? null : status.pin);
    $("connectionSummaryLabel").textContent = isWebxr ? "URL" : "PIN";
    if (isWebxr) setHref(pinSummary, status.webxr_url, "Address available after Start");
    else setText(pinSummary, status.pin);
    setText(robotValue, displayRobotIp(status.robot_ip));

    const showWebxr = isWebxr;
    webxrNetworkRow.classList.toggle("hidden", !showWebxr);
    webxrHint.classList.toggle("hidden", !showWebxr);
    setHref(webxrNetwork, status.webxr_url);
  }

  function applyStatus(status) {
    lastStatus = status || {};
    if (status.planner) plannerStatus = status.planner;
    const nextPython = status.dimos_python || null;
    const environmentChanged = nextPython !== plannerPython;
    plannerPython = nextPython;
    phase = status.phase || "idle";
    if ("check_ok" in status) checkOk = status.check_ok;

    applyHeader(status);
    const deps = describeDeps(status);
    depsSummary.textContent = deps.text;
    depsSummary.dataset.phase = deps.phase;
    if (["starting", "running", "stopping"].includes(phase) && status.client) {
      client = status.client;
      document.querySelectorAll("[data-client]").forEach(btn => btn.classList.toggle("active", btn.dataset.client === client));
    }
    applyConnectionStatus(status);

    if (status.warning) {
      warningText.textContent = status.warning;
      warningText.classList.remove("hidden");
    } else {
      warningText.classList.add("hidden");
    }

    if (status.error && phase !== "error") {
      errorText.textContent = status.error;
      errorText.classList.remove("hidden");
    } else {
      errorText.classList.add("hidden");
    }

    if ("openai_api_key" in status && document.activeElement !== apiKey) {
      apiKey.value = status.openai_api_key || "";
    }
    if ("multiset_client_id" in status && document.activeElement !== multisetClientId) {
      multisetClientId.value = status.multiset_client_id || "";
    }
    if (
      "multiset_client_secret" in status &&
      document.activeElement !== multisetClientSecret
    ) {
      multisetClientSecret.value = status.multiset_client_secret || "";
    }
    syncConfigCards();

    const busy =
      phase === "checking" ||
      phase === "installing" ||
      phase === "starting" ||
      phase === "stopping";
    const running = phase === "running" || phase === "starting";
    const locked = phase === "starting" || phase === "running" || phase === "stopping";

    controlsCard.classList.remove("hidden");
    actionsBar.classList.remove("hidden");
    syncInstallBanner();

    if (status.default_clone_dir && !cloneDir.value) {
      cloneDir.value = status.default_clone_dir;
    }
    if ((status.dimos_install_dir || status.dimos_python) && !dimosPython.value) {
      dimosPython.value = status.dimos_install_dir || status.dimos_python;
    }

    startBtn.disabled = busy || running || checkOk !== true;
    stopBtn.disabled = false;
    stopBtn.textContent = phase === "stopping" ? "Force stop" : "Stop";
    stopBtn.classList.toggle(
      "danger",
      phase === "running" || phase === "starting" || phase === "stopping"
    );
    setConfigLocked(locked);
    syncHardwareSetup();
    if (environmentChanged || phase === "ready") { void refreshPlanner(); }

  }

  function syncSetupMode() {
    const existing = setupMode() === "existing";
    cloneDirField.classList.toggle("hidden", existing);
    dimosPythonField.classList.toggle("hidden", !existing);
    syncInstallBanner();
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
      if (configLocked) return;
      document.querySelectorAll("[data-client]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      client = btn.dataset.client;
      applyConnectionStatus(lastStatus);
    });
  });

  blueprintSelect.addEventListener("change", async () => {
    if (configLocked) return;
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; await saveSettings(); }
    blueprint = blueprintSelect.value;
    localStorage.setItem("dimos.blueprint", blueprint);
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
    if (configLocked) return;
    mounts = [cloneMount(DEFAULT_MOUNT)];
    renderMountEditor();
    schedulePersist();
  });

  const addUploadInput = makeFileInput(async (file) => {
    const markerId = await decodeUploadedPng(file);
    if (usedMarkerIds().has(markerId)) {
      appendLog(`Fiducial marker ID ${markerId} is already in the list`);
      return;
    }
    const template = cloneMount(mounts[0] || DEFAULT_MOUNT);
    template.marker_id = markerId;
    mounts = [...mounts, template];
    renderMountEditor();
    schedulePersist();
  });
  document.body.append(addUploadInput);

  addTagBtn.addEventListener("click", () => {
    if (configLocked) return;
    const nextId = nextUnusedPresetId();
    if (nextId == null) {
      appendLog("All pre-built markers are in use. Upload a PNG to add another.");
      addUploadInput.click();
      return;
    }
    const template = cloneMount(mounts[0] || DEFAULT_MOUNT);
    template.marker_id = nextId;
    mounts = [...mounts, template];
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

  let dimosPickerOpen = false;
  dimosPython.addEventListener("click", async () => {
    if (dimosPickerOpen) return;
    dimosPickerOpen = true;
    try {
      const res = await fetch("/api/browse-dimos-install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: dimosPython.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        appendLog(`File chooser error: ${data.detail || res.statusText}`);
      } else if (data.path) {
        dimosPython.value = data.path;
      }
    } catch (err) {
      appendLog(`File chooser error: ${err}`);
    } finally {
      dimosPickerOpen = false;
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
    body.manipulation = blueprint === "openyam_ar_planner";
    installBtn.disabled = true;
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
      if (data.phase || "check_ok" in data) applyStatus(data);
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
    if (!(await saveSettings())) { startBtn.disabled = false; return; }
    await saveLauncherPreferences().catch(error => appendLog(`Could not save launcher preferences: ${error}`));
    const body = {
      blueprint,
      client,
      profile_id: robotProfileId,
        source: { mode: $("robotSource").value.startsWith("device:") ? "device" : $("robotSource").value,
        device_id: $("robotSource").value.replace(/^device:/, ""), address: robotIp.value.trim(),
        replay: $("replayPath").value.trim() || null, playback: $("playbackSource").value,
        streams: replayStreams[manipulationSelected() ? "openyam" : "go2"] || {} },
    };
    try {
      const res = await fetch("/api/armodule/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = data.detail;
        if (Array.isArray(detail?.devices)) {
          for (const device of detail.devices) {
            const value = `device:${device.id}`;
            if (![...$("robotSource").options].some(option => option.value === value)) {
              const option = document.createElement("option"); option.value = value; option.textContent = device.label || device.id; $("robotSource").insertBefore(option, $("robotSource").querySelector('[value="simulated"]'));
            }
          }
        }
        if (detail?.suggest_simulated) { $("robotSource").value = "simulated"; syncSource(); }
        $("discoveryStatus").textContent = detail?.message || String(detail || res.statusText);
        appendLog(`Start error: ${detail?.message || detail || res.statusText}`);
        startBtn.disabled = false;
      }
      if (data.phase) applyStatus(data);
    } catch (err) {
      appendLog(`Start error: ${err}`);
      startBtn.disabled = false;
    }
  });

  stopBtn.addEventListener("click", async () => {
    try {
      const res = await fetch(`/api/armodule/stop?force=${stopBtn.textContent === "Force stop"}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.phase) applyStatus(data);
    } catch (err) {
      appendLog(`Stop error: ${err}`);
    }
  });

  async function loadConfig() {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) applySettingsPayload(await res.json());
    } catch (_) {
      /* ignore */
    }
  }

  async function loadDimosRefs() {
    try {
      const res = await fetch("/api/dimos-refs");
      if (!res.ok) return;
      const data = await res.json();
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
      /* ignore */
    }
  }

  function connectEvents() {
    const source = new EventSource("/api/events");
    source.onmessage = (ev) => {
      let data;
      try {
        data = JSON.parse(ev.data);
      } catch (_) {
        return;
      }
      if (data.type === "log") {
        appendLog(data.line);
      } else if (data.type === "status") {
        applyStatus(data);
      }
    };
    source.onerror = () => {
      // Browser will reconnect; avoid spamming the log.
    };
  }

  loadConfig();
  loadDimosRefs();
  connectEvents();
  fetch("/api/status")
    .then((r) => r.json())
    .then(applyStatus)
    .catch(() => {});

  async function refreshRobotProfiles(preferredId = robotProfileId) {
    const generation = ++profileLoadGeneration;
    const response = await fetch("/api/robot-profiles");
    if (!response.ok) { appendLog("Could not load robot profiles"); return; }
    const data = await response.json();
    if (generation !== profileLoadGeneration) return;
    const robot = blueprint === "openyam_ar_planner" ? "openyam" : "unitree_go2";
    robotProfiles = data.profiles.filter(profile => profile.robot === robot);
    if (!robotProfiles.length) {
      await fetch("/api/robot-profiles", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ robot }) });
      return refreshRobotProfiles(null);
    }
    const select = $("robotProfileSelect"); select.replaceChildren();
    for (const profile of robotProfiles) {
      const option = document.createElement("option"); option.value = profile.id; option.textContent = profile.name; select.append(option);
    }
    const remembered = localStorage.getItem(`dimos.profile.${robot}`);
    robotProfileId = robotProfiles.some(p => p.id === preferredId) ? preferredId : robotProfiles.some(p => p.id === remembered) ? remembered : robotProfiles[0].id;
    localStorage.setItem(`dimos.profile.${robot}`, robotProfileId);
    select.value = robotProfileId;
    applyRobotProfile();
  }
  function applyRobotProfile() {
    const profile = robotProfiles.find(p => p.id === robotProfileId);
    if (!profile) return;
    $("robotProfileName").value = profile.name;
    const settings = profile.settings;
    fiducialEnabled.checked = settings.fiducial_marker;
    vpsEnabled.checked = settings.vps;
    mapCode.value = settings.map_code || "";
    mounts = settings.mounts.map(cloneMount);
    syncLocalizationPanels(); renderMountEditor(); syncConfigCards();
  }
  $("robotProfileSelect").addEventListener("change", async () => {
    if (configLocked) return;
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; if (!(await saveSettings())) { $("robotProfileSelect").value = robotProfileId; return; } }
    robotProfileId = $("robotProfileSelect").value;
    localStorage.setItem(`dimos.profile.${blueprint === "openyam_ar_planner" ? "openyam" : "unitree_go2"}`, robotProfileId);
    applyRobotProfile();
  });
  function syncSource() {
    const simulated = $("robotSource").value === "simulated";

    $("replayRow").classList.toggle("hidden", !simulated);
    const robot = manipulationSelected() ? "openyam" : "go2";
    if (robot !== playbackRobot) {
      playbackRobot = robot;
      $("replayPath").value = localStorage.getItem(`dimos.replay.${robot}`) || "";
      $("playbackSource").value = robot === "openyam" ? localStorage.getItem("dimos.playback.openyam") || "simulator" : "recording";
      $("replayStreams").replaceChildren();
      $("replayStatus").textContent = "";
    }
    $("playbackSource").querySelector('[value="simulator"]').hidden = !manipulationSelected();
    $("replayName").textContent = $("replayPath").value || (manipulationSelected() ? "Choose a recording" : "Default recording");
    $("editReplay").disabled = configLocked || $("playbackSource").value !== "recording";


    syncHardwareSetup();
    if (manipulationSelected()) void refreshCan();
  }
  robotIp.addEventListener("change", () => { void saveLauncherPreferences(); });
  $("robotSource").addEventListener("change", () => {
    localStorage.setItem(`dimos.source.${manipulationSelected() ? "openyam" : "go2"}`, $("robotSource").value);
    syncSource();
    void saveLauncherPreferences();
  });
  async function refreshRobotDiscovery() {
    if (configLocked || discoveryPending) return;
    discoveryPending = true;
    if (!manipulationSelected()) go2DiscoveryState = {text: "Scanning…", phase: "checking"};
    syncHardwareSetup();
    const generation = ++discoveryGeneration;
    let selected = $("robotSource").value;
    const requestedPython = plannerPython;
    const requestedBlueprint = blueprint;
    $("discoveryStatus").textContent = "Scanning…";
    try {
      const response = await fetch(`/api/discovery?robot=${manipulationSelected() ? "openyam" : "unitree_go2"}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Discovery failed");
      if (blueprint !== requestedBlueprint || requestedPython !== plannerPython || generation !== discoveryGeneration) return;
      selected = $("robotSource").value;
      if (manipulationSelected() && selected === "auto" && data.devices.length === 1) {
        resolvedCan = data.devices[0].address; void refreshCan();
      }
      discoveredRobots[manipulationSelected() ? "openyam" : "go2"] = data.devices;
      if (!manipulationSelected()) go2DiscoveryState = {text: data.devices.length ? `${data.devices.length} found` : "None found", phase: data.devices.length ? "ready" : "needs_setup"};
      const select = $("robotSource");
      select.querySelectorAll('[value^="device:"]').forEach(option => option.remove());
      for (const device of data.devices) { const option = document.createElement("option"); option.value = `device:${device.id}`; option.textContent = device.label; select.insertBefore(option, select.querySelector('[value="simulated"]')); }
      if ([...select.options].some(option => option.value === selected)) select.value = selected;
      else if (selected.startsWith("device:")) { const option = document.createElement("option"); option.value = selected; option.textContent = "Selected device unavailable"; select.insertBefore(option, select.querySelector('[value="simulated"]')); select.value = selected; }
      $("discoveryStatus").textContent = data.devices.length ? `${data.devices.length} connection(s) found` : "No devices found. Check the connection and try Discover again.";
    } catch (error) {
      $("discoveryStatus").textContent = String(error);
      if (blueprint === requestedBlueprint && !manipulationSelected()) go2DiscoveryState = {text: "Discovery failed", phase: "error"};
    } finally { discoveryPending = false; syncHardwareSetup(); }
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
    let option = $("robotSource").querySelector('[value="manual"]');
    if (!option) { option = document.createElement("option"); option.value = "manual"; $("robotSource").insertBefore(option, $("robotSource").querySelector('[value="simulated"]')); }
    option.textContent = `${robotIp.value.trim()} (manual)`; $("robotSource").value = "manual";
    $("connectionEditor").classList.add("hidden"); $("robotSource").dispatchEvent(new Event("change"));
  });
  $("editReplay").addEventListener("click", () => $("replayEditor").classList.toggle("hidden"));
  $("playbackSource").addEventListener("change", () => {
    if (manipulationSelected()) localStorage.setItem("dimos.playback.openyam", $("playbackSource").value);
    syncSource(); void saveLauncherPreferences();
  });
  async function inspectReplay() {
    const generation = ++replayInspectionGeneration;
    const path = $("replayPath").value.trim();
    if (!path) return;
    const robot = manipulationSelected() ? "openyam" : "go2";
    $("replayStatus").textContent = "Checking recording…";
    try {
      const response = await fetch("/api/replay/inspect", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({path, robot: robot === "go2" ? "unitree_go2" : robot, streams: replayStreams[robot] || {}})});
      const data = await response.json();
      if (generation !== replayInspectionGeneration || robot !== playbackRobot || path !== $("replayPath").value.trim()) return;
      if (!response.ok) throw new Error(data.detail || "Invalid recording");
      replayStreams[robot] = data.streams;
      $("replayStreams").replaceChildren();
      for (const [role, choices] of Object.entries(data.candidates)) {
        if (choices.length < 2) continue;
        const label = document.createElement("label"); label.className = "field"; label.textContent = `${role} stream`;
        const select = document.createElement("select"); select.setAttribute("aria-label", `${role} stream`);
        const empty = document.createElement("option"); empty.value = ""; empty.textContent = "Choose stream"; select.append(empty);
        for (const name of choices) { const option = document.createElement("option"); option.value = name; option.textContent = name; select.append(option); }
        select.value = data.streams[role] || "";
        select.addEventListener("change", () => { if (select.value) replayStreams[robot][role] = select.value; else delete replayStreams[robot][role]; void inspectReplay(); });
        label.append(select); $("replayStreams").append(label);
      }
      $("replayStatus").textContent = data.needs_selection ? "Choose streams before starting." : "Recording ready · read-only · 1×";
      void saveLauncherPreferences();
    } catch (error) { $("replayStatus").textContent = String(error); }
  }
  $("replayPath").addEventListener("change", () => {
    const robot = manipulationSelected() ? "openyam" : "go2";
    const path = $("replayPath").value.trim();
    if (path === (localStorage.getItem(`dimos.replay.${robot}`) || "")) return;
    replayStreams[robot] = {};
    localStorage.setItem(`dimos.replay.${robot}`, path);
    syncSource(); void saveLauncherPreferences(); void inspectReplay();
  });
  $("browseReplay").addEventListener("click", async () => {
    if (configLocked) return;
    try {
      const response = await fetch("/api/browse-replay", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not select recording");
      if (data.path) { $("replayPath").value = data.path; $("replayPath").dispatchEvent(new Event("change")); }
    } catch (error) { $("discoveryStatus").textContent = String(error); }
  });
  $("defaultReplay").addEventListener("click", () => {
    $("replayPath").value = ""; localStorage.removeItem(`dimos.replay.${playbackRobot}`);
    replayStreams[playbackRobot] = {}; replayInspectionGeneration++;
    $("replayStreams").replaceChildren(); $("replayStatus").textContent = "";
    syncSource(); void saveLauncherPreferences();
  });
  void fetch("/api/launcher-preferences").then(response => response.ok ? response.json() : {}).then(preferences => {
    if (configLocked || preferencesEdited) return;
    for (const [robot, key] of [["go2", "go2_source"], ["openyam", "openyam_source"]]) {
      if (typeof preferences[key] === "string") localStorage.setItem(`dimos.source.${robot}`, preferences[key]);
    }
    if (typeof preferences.replay === "string") localStorage.setItem("dimos.replay.go2", preferences.replay);
    if (typeof preferences.openyam_replay === "string") localStorage.setItem("dimos.replay.openyam", preferences.openyam_replay);
    if (typeof preferences.openyam_playback === "string") localStorage.setItem("dimos.playback.openyam", preferences.openyam_playback);
    Object.assign(replayStreams, preferences.replay_streams || {});
    playbackRobot = null;
    if (typeof preferences.manual_ip === "string") robotIp.value = preferences.manual_ip;
    const value = localStorage.getItem(`dimos.source.${manipulationSelected() ? "openyam" : "go2"}`) || "auto";
    if (![...$("robotSource").options].some(option => option.value === value) && (value.startsWith("device:") || value === "manual")) {
      const option = document.createElement("option"); option.value = value; option.textContent = option.value === "manual" ? `${robotIp.value.trim()} (manual)` : `${option.value.slice(7)} (saved)`; $("robotSource").insertBefore(option, $("robotSource").querySelector('[value="simulated"]'));
    }
    $("robotSource").value = value; syncSource();
    if (value.startsWith("device:")) void refreshRobotDiscovery();
  }).catch(error => appendLog(`Could not load launcher preferences: ${error}`));
  async function saveLauncherPreferences() {
    preferencesEdited = true;
    localStorage.setItem(`dimos.source.${manipulationSelected() ? "openyam" : "go2"}`, $("robotSource").value);
    const body = JSON.stringify({
      go2_source: localStorage.getItem("dimos.source.go2") || "auto", openyam_source: localStorage.getItem("dimos.source.openyam") || "auto",
      replay: localStorage.getItem("dimos.replay.go2") || "", openyam_replay: localStorage.getItem("dimos.replay.openyam") || "",
      openyam_playback: localStorage.getItem("dimos.playback.openyam") || "simulator", replay_streams: replayStreams, manual_ip: robotIp.value.trim() });
    preferencesSave = preferencesSave.catch(() => {}).then(async () => {
      const response = await fetch("/api/launcher-preferences", {method: "PUT", headers: {"Content-Type": "application/json"}, body});
      if (!response.ok) throw new Error("Could not save launcher preferences");
    });
    return preferencesSave;
  }
  $("profileEdit").addEventListener("click", () => {
    if (configLocked) return;
    const editor = $("profileEditor");
    editor.classList.toggle("hidden");
    $("profileEdit").setAttribute("aria-expanded", String(!editor.classList.contains("hidden")));
    if (!editor.classList.contains("hidden")) $("robotProfileName").focus();
  });
  const closeProfileEditor = () => { $("robotProfileName").value = robotProfiles.find(profile => profile.id === robotProfileId)?.name || ""; $("deleteProfileConfirm").classList.add("hidden"); $("profileEditor").classList.add("hidden"); $("profileEdit").setAttribute("aria-expanded", "false"); };
  $("profileDone").addEventListener("click", closeProfileEditor);
  document.addEventListener("click", event => {
    if (!$("profileEditor").contains(event.target) && !$("profileEdit").contains(event.target)) closeProfileEditor();
  });
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeProfileEditor(); });
  $("cancelProfileName").addEventListener("click", () => { applyRobotProfile(); closeProfileEditor(); });
  $("robotProfileName").addEventListener("keydown", event => { if (event.key === "Enter") $("saveProfileName").click(); });
  $("saveProfileName").addEventListener("click", async () => {
    if (configLocked || !robotProfileId) return;
    const response = await fetch(`/api/robot-profiles/${robotProfileId}`, { method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify({name: $("robotProfileName").value}) });
    if (!response.ok) { $("profileError").textContent = "Could not save profile name. Use 1–80 characters."; $("profileError").classList.remove("hidden"); return; }
    $("profileError").classList.add("hidden");
    await refreshRobotProfiles(); closeProfileEditor();
  });
  async function createRobotProfile() {
    if (configLocked) return;
    if (!(await saveSettings())) return;
    const response = await fetch("/api/robot-profiles", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({robot: blueprint === "openyam_ar_planner" ? "openyam" : "unitree_go2",  source_id: null}) });
    const created = await response.json();
    if (!response.ok) { appendLog("Profile creation failed"); return; }
    await refreshRobotProfiles(created.id);
  }
  $("newRobotProfile").addEventListener("click", () => createRobotProfile());
  $("deleteRobotProfile").addEventListener("click", () => $("deleteProfileConfirm").classList.remove("hidden"));
  $("confirmDeleteProfile").addEventListener("click", async () => {
    if (configLocked || !robotProfileId) return;
    const response = await fetch(`/api/robot-profiles/${robotProfileId}`, {method: "DELETE"});
    if (response.ok) { $("deleteProfileConfirm").classList.add("hidden"); await refreshRobotProfiles(null); } else appendLog("Profile deletion failed");
  });
})();
