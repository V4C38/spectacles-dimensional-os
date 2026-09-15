(() => {
  const $ = (id) => document.getElementById(id);

  const stateValue = $("stateValue");
  const stateDetail = $("stateDetail");
  const hostIp = $("hostIp");
  const hostIpSummary = $("hostIpSummary");
  const webxrLocal = $("webxrLocal");
  const webxrNetwork = $("webxrNetwork");
  const webxrLocalRow = $("webxrLocalRow");
  const webxrNetworkRow = $("webxrNetworkRow");
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
  const robotIpAuto = $("robotIpAuto");
  const apiKey = $("apiKey");
  const revealKey = $("revealKey");
  const logEl = $("log");
  const copyLogBtn = $("copyLogBtn");
  const clearLogBtn = $("clearLogBtn");
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

  let client = "specs";
  let blueprint = "unitree_go2_ar";
  let phase = "idle";
  let checkOk = null;
  let lastStatus = {};
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
  ];

  const BLUEPRINTS = {
    unitree_go2_ar: {
      info: "Unitree Go2 with ARModule\nManual Mode: place navigation goals from the headset.",
    },
    unitree_go2_ar_agentic: {
      info: "Unitree Go2 with ARModule\nManual Mode: place navigation goals from the headset.\nAgent Mode: voice commands via LLM and MCP (API key required)",
      agent: true,
    },
  };

  const LOG_LEVELS = ["DEBUG", "INFO", "WARNING", "ERROR"];

  function applyBlueprintInfo() {
    blueprint = blueprintSelect.value;
    const spec = BLUEPRINTS[blueprint] || {};
    blueprintInfo.textContent = spec.info || "";
    agentConfig.classList.toggle("hidden", !spec.agent);
    syncConfigCards();
  }

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
        return data;
      }
      if (data.phase) applyStatus(data);
      return data;
    } catch (err) {
      appendLog(`Settings save failed: ${err}`);
      return {};
    }
  }

  function applySettingsPayload(data) {
    if (data.defaults?.mounts?.[0]) {
      Object.assign(DEFAULT_MOUNT, cloneMount(data.defaults.mounts[0]));
    }
    if (Array.isArray(data.defaults?.preset_marker_ids) && data.defaults.preset_marker_ids.length) {
      presetMarkerIds = data.defaults.preset_marker_ids.map(Number);
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
    apiKey.disabled = locked;
    revealKey.disabled = locked;
    robotIp.disabled = locked;
    robotIpAuto.disabled = locked;
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
    input.value = String(value);
    input.dataset.field = meta.field;
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

      const thumb = document.createElement("a");
      thumb.target = "_blank";
      thumb.rel = "noopener";
      thumb.title = "Open printable PDF";
      thumb.addEventListener("click", (ev) => ev.stopPropagation());
      const img = document.createElement("img");
      img.className = "tag-thumb";
      thumb.append(img);

      const metaWrap = document.createElement("div");
      metaWrap.className = "tag-summary-meta";
      const title = document.createElement("div");
      title.className = "tag-title";
      const subtitle = document.createElement("div");
      subtitle.className = "tag-subtitle";
      metaWrap.append(title, subtitle);

      const syncThumb = () => {
        const current = mounts[index];
        const id = current.marker_id;
        const size = current.print_size_mm;
        img.src = `/api/apriltag/${id}.png`;
        thumb.href = `/api/apriltag/${id}.pdf?size_mm=${encodeURIComponent(size)}`;
        img.alt = `Fiducial marker ${id}`;
        title.textContent = isPresetId(id)
          ? `Fiducial marker ${id}`
          : `Fiducial marker ${id} (uploaded)`;
        subtitle.textContent = `${size} mm total · ${(size * 0.8).toFixed(0)} mm black`;
      };

      summary.append(thumb, metaWrap);

      const body = document.createElement("div");
      body.className = "tag-body";

      const picker = document.createElement("div");
      picker.className = "tag-picker";
      const used = usedMarkerIds(index);
      presetMarkerIds.forEach((presetId) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tag-preset";
        btn.dataset.markerId = String(presetId);
        btn.setAttribute("aria-pressed", String(mount.marker_id === presetId));
        btn.disabled = configLocked || (used.has(presetId) && mount.marker_id !== presetId);
        const presetImg = document.createElement("img");
        presetImg.src = `/api/apriltag/${presetId}.png`;
        presetImg.alt = `ID ${presetId}`;
        const presetLabel = document.createElement("span");
        presetLabel.textContent = `ID ${presetId}`;
        btn.append(presetImg, presetLabel);
        btn.addEventListener("click", (ev) => {
          ev.preventDefault();
          if (configLocked) return;
          if (!assignMarkerId(index, presetId)) return;
          renderMountEditor();
          schedulePersist();
        });
        picker.append(btn);
      });

      const uploadLabel = document.createElement("label");
      uploadLabel.className = "tag-preset tag-upload";
      const uploadText = document.createElement("span");
      uploadText.textContent = "Upload PNG";
      const uploadInput = makeFileInput(async (file) => {
        const markerId = await decodeUploadedPng(file);
        if (!assignMarkerId(index, markerId)) return;
        renderMountEditor();
        schedulePersist();
      });
      uploadLabel.append(uploadInput, uploadText);
      picker.append(uploadLabel);

      const grid = document.createElement("div");
      grid.className = "tag-grid";
      FIELD_META.forEach((meta) => {
        const field = document.createElement("label");
        field.className = "tag-field";
        if (meta.field === "print_size_mm") field.classList.add("span-2");
        const label = document.createElement("span");
        label.textContent = meta.label;
        const control = makeNumInput(meta, mount[meta.field], (next) => {
          if (configLocked) return;
          mounts[index] = { ...mounts[index], [meta.field]: next };
          syncThumb();
          schedulePersist();
        });
        field.append(label, control);
        grid.append(field);
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
      syncThumb();
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
        if (status.check_ok !== true || locNotSetup() || agentNotSetup()) {
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
    if (status.check_ok === true) {
      return { text: "", phase: "" };
    }
    return { text: "incomplete", phase: "needs_setup" };
  }

  function setupMode() {
    return document.querySelector('input[name="setupMode"]:checked')?.value || "existing";
  }

  function syncInstallBanner() {
    const ready = checkOk === true;
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
    installBtn.disabled = busy || phase === "installing" || phase === "checking";
    installBanner.classList.toggle("needs-setup", needsInstall);

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

  function makeLogLineEl(line) {
    const el = document.createElement("div");
    el.className = "log-line";
    el.innerHTML = ansiToHtml(line);
    return el;
  }

  function flushLog() {
    frameHandle = null;
    if (!pendingLines.length) return;
    const nearBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 48;
    const fragment = document.createDocumentFragment();
    for (const line of pendingLines) {
      fragment.appendChild(makeLogLineEl(line));
      logLines.push(line);
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
    const text = logLines.map(stripAnsi).join("\n");
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

  function displayRobotIp(value) {
    if (!value || !String(value).trim()) return "";
    const raw = String(value).trim();
    if (raw === "fake" || raw === "simulated" || raw === "mock" || raw === "replay") {
      return "simulated";
    }
    return raw;
  }

  function applyStatus(status) {
    lastStatus = status || {};
    phase = status.phase || "idle";
    if ("check_ok" in status) checkOk = status.check_ok;

    applyHeader(status);
    const deps = describeDeps(status);
    depsSummary.textContent = deps.text;
    depsSummary.dataset.phase = deps.phase;
    setText(hostIp, status.host_ip);
    setText(hostIpSummary, status.host_ip);
    setText(robotValue, displayRobotIp(status.robot_ip));

    const showWebxr = Boolean(status.webxr_local_url || status.webxr_url);
    webxrLocalRow.classList.toggle("hidden", !showWebxr);
    webxrNetworkRow.classList.toggle("hidden", !showWebxr);
    setText(webxrLocal, status.webxr_local_url);
    setText(webxrNetwork, status.webxr_url);

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
    if (status.dimos_python && !dimosPython.value) {
      dimosPython.value = status.dimos_python;
    }

    startBtn.disabled = busy || running || !ready;
    stopBtn.disabled = false;
    stopBtn.classList.toggle(
      "danger",
      phase === "running" || phase === "starting" || phase === "stopping"
    );
    setConfigLocked(locked);
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
    });
  });

  blueprintSelect.addEventListener("change", () => {
    if (configLocked) return;
    blueprint = blueprintSelect.value;
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

  function syncRobotIpOverride() {
    const auto = robotIpAuto.checked;
    robotValue.classList.toggle("hidden", !auto);
    robotIp.classList.toggle("hidden", auto);
    if (!auto) {
      const shown = robotValue.textContent.trim();
      if (!robotIp.value.trim() && shown && shown !== "—" && shown !== "simulated") {
        robotIp.value = shown;
      }
      robotIp.focus();
    }
  }
  robotIpAuto.addEventListener("change", syncRobotIpOverride);
  syncRobotIpOverride();

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
    await saveSettings();
    const body = {
      blueprint,
      client,
      robot_ip: robotIpAuto.checked ? null : robotIp.value.trim() || null,
    };
    try {
      const res = await fetch("/api/armodule/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        appendLog(`Start error: ${data.detail || res.statusText}`);
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
      const res = await fetch("/api/armodule/stop", { method: "POST" });
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
})();
