(() => {
  const $ = (id) => document.getElementById(id);

  const stateValue = $("stateValue");
  const stateDetail = $("stateDetail");
  const bridgeIp = $("bridgeIp");
  const bridgeIpSummary = $("bridgeIpSummary");
  const robotValue = $("robotValue");
  const warningText = $("warningText");
  const errorText = $("errorText");
  const setupCard = $("setupCard");
  const controlsCard = $("controlsCard");
  const actionsBar = $("actionsBar");
  const cloneDir = $("cloneDir");
  const dimosPython = $("dimosPython");
  const cloneDirField = $("cloneDirField");
  const dimosPythonField = $("dimosPythonField");
  const installBtn = $("installBtn");
  const startBtn = $("startBtn");
  const stopBtn = $("stopBtn");
  const robotIp = $("robotIp");
  const robotIpAuto = $("robotIpAuto");
  const robotIpOverrideField = $("robotIpOverrideField");
  const apiKey = $("apiKey");
  const revealKey = $("revealKey");
  const logEl = $("log");
  const copyLogBtn = $("copyLogBtn");
  const clearLogBtn = $("clearLogBtn");
  const sidePanel = $("sidePanel");
  const splitter = $("splitter");
  const stackInfoList = $("stackInfoList");
  const tagList = $("tagList");
  const addTagBtn = $("addTagBtn");
  const restoreTagsBtn = $("restoreTagsBtn");

  let stack = "go2";
  let phase = "idle";
  let keyVisible = false;
  const logLines = [];

  /** Populated from GET /api/tag-config (backend owns robot_profile defaults). */
  let defaultTagIds = { go2: new Set(), g1: new Set() };
  let defaultTagConfig = { go2: [], g1: [] };
  let tagConfig = { go2: [], g1: [] };
  let tagConfigReady = false;
  let persistTimer = null;
  let configLocked = false;

  const STACK_LABELS = {
    go2: "Unitree Go2",
    g1: "Unitree G1",
  };

  const STACK_INFO = {
    go2: [
      ["Nav", "Go2 smart stack"],
      ["Blueprint", "ar_go2"],
      ["Streams", "lidar · odom · path · costmap"],
    ],
    g1: [
      ["Nav", "G1 nav-simple stack"],
      ["Blueprint", "ar_g1"],
      ["Streams", "lidar · odometry · path · costmap"],
    ],
  };

  const FIELD_META = [
    { field: "tag_id", label: "ID", step: 1, min: 0, max: 586 },
    { field: "print_size_mm", label: "Print size (mm)", step: 1, min: 20, max: 200 },
    { field: "forward_m", label: "Forward (m)", step: 0.01 },
    { field: "lateral_m", label: "Lateral (m)", step: 0.01 },
    { field: "up_m", label: "Up (m)", step: 0.01 },
    { field: "yaw_deg", label: "Yaw (°)", step: 1 },
    { field: "pitch_deg", label: "Pitch (°)", step: 1 },
  ];

  function renderInfoList(el, rows) {
    el.replaceChildren(
      ...rows.map(([label, value]) => {
        const row = document.createElement("div");
        row.className = "info-row";
        const dt = document.createElement("dt");
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.textContent = value;
        row.append(dt, dd);
        return row;
      })
    );
  }

  function applyStackInfo(selected) {
    renderInfoList(stackInfoList, STACK_INFO[selected] || STACK_INFO.go2);
  }

  function cloneTag(tag) {
    return {
      tag_id: Number(tag.tag_id) || 0,
      print_size_mm: Number(tag.print_size_mm) > 0 ? Number(tag.print_size_mm) : 70,
      forward_m: Number(tag.forward_m) || 0,
      lateral_m: Number(tag.lateral_m) || 0,
      up_m: Number(tag.up_m) || 0,
      yaw_deg: Number(tag.yaw_deg) || 0,
      pitch_deg: Number(tag.pitch_deg) || 0,
    };
  }

  function schedulePersist() {
    if (configLocked) return;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persistTagConfig, 400);
  }

  async function persistTagConfig() {
    try {
      const res = await fetch("/api/tag-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tagConfig),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        appendLog(`Tag config save failed: ${data.detail || res.statusText}`);
      }
    } catch (err) {
      appendLog(`Tag config save failed: ${err}`);
    }
  }

  function isProtectedDefaultTag(tag) {
    return defaultTagIds[stack]?.has(Number(tag.tag_id));
  }

  function applyTagConfigPayload(data) {
    if (data.defaults) {
      defaultTagConfig = {
        go2: (data.defaults.go2 || []).map(cloneTag),
        g1: (data.defaults.g1 || []).map(cloneTag),
      };
    }
    if (data.default_tag_ids) {
      defaultTagIds = {
        go2: new Set(data.default_tag_ids.go2 || []),
        g1: new Set(data.default_tag_ids.g1 || []),
      };
    } else {
      defaultTagIds = {
        go2: new Set(defaultTagConfig.go2.map((t) => t.tag_id)),
        g1: new Set(defaultTagConfig.g1.map((t) => t.tag_id)),
      };
    }
    tagConfig = {
      go2: (data.go2 || []).map(cloneTag),
      g1: (data.g1 || []).map(cloneTag),
    };
    tagConfigReady = true;
    renderTagEditor();
  }

  function setConfigLocked(locked) {
    configLocked = locked;
    controlsCard.classList.toggle("locked", locked);
    document.querySelectorAll(".tab").forEach((btn) => {
      btn.disabled = locked;
    });
    apiKey.disabled = locked;
    revealKey.disabled = locked;
    robotIp.disabled = locked;
    robotIpAuto.disabled = locked;
    addTagBtn.disabled = locked;
    restoreTagsBtn.disabled = locked;
    tagList.querySelectorAll("input, button").forEach((el) => {
      el.disabled = locked;
    });
  }

  function makeNumInput(meta, value, onChange, lockedField = false) {
    const wrap = document.createElement("div");
    wrap.className = "num-input";
    const fieldLocked = configLocked || lockedField;

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
    input.disabled = fieldLocked;

    const inc = document.createElement("button");
    inc.type = "button";
    inc.className = "num-btn";
    inc.textContent = "+";
    inc.setAttribute("aria-label", `Increase ${meta.label}`);

    const commit = (next) => {
      let n = Number(next);
      if (!Number.isFinite(n)) n = 0;
      if (meta.field === "tag_id") n = Math.round(n);
      if (meta.min != null) n = Math.max(meta.min, n);
      if (meta.max != null) n = Math.min(meta.max, n);
      if (meta.field === "print_size_mm" && n <= 0) n = 70;
      input.value = String(n);
      onChange(n);
    };

    dec.addEventListener("click", () => {
      if (fieldLocked) return;
      commit(Number(input.value) - meta.step);
    });
    inc.addEventListener("click", () => {
      if (fieldLocked) return;
      commit(Number(input.value) + meta.step);
    });
    input.addEventListener("change", () => commit(input.value));

    dec.disabled = fieldLocked;
    inc.disabled = fieldLocked;
    wrap.append(dec, input, inc);
    return wrap;
  }

  function renderTagEditor() {
    if (!tagConfigReady) {
      tagList.replaceChildren();
      return;
    }
    const tags = tagConfig[stack] || [];
    tagList.replaceChildren();
    tags.forEach((tag, index) => {
      const card = document.createElement("details");
      card.className = "tag-card";

      const summary = document.createElement("summary");
      summary.className = "tag-summary";

      const thumb = document.createElement("a");
      thumb.target = "_blank";
      thumb.rel = "noopener";
      thumb.title = "Open printable PDF";
      thumb.addEventListener("click", (ev) => ev.stopPropagation());
      const img = document.createElement("img");
      img.className = "tag-thumb";
      img.alt = `AprilTag ${tag.tag_id}`;
      thumb.append(img);

      const metaWrap = document.createElement("div");
      metaWrap.className = "tag-summary-meta";
      const title = document.createElement("div");
      title.className = "tag-title";
      const subtitle = document.createElement("div");
      subtitle.className = "tag-subtitle";
      metaWrap.append(title, subtitle);

      const syncThumb = () => {
        const id = tagConfig[stack][index].tag_id;
        const size = tagConfig[stack][index].print_size_mm;
        img.src = `/api/apriltag/${id}.png`;
        thumb.href = `/api/apriltag/${id}.pdf?size_mm=${encodeURIComponent(size)}`;
        img.alt = `AprilTag ${id}`;
        title.textContent = isProtectedDefaultTag({ tag_id: id })
          ? `AprilTag ${id} (default)`
          : `AprilTag ${id}`;
        subtitle.textContent = `${size} mm total · ${(size * 0.8).toFixed(0)} mm black`;
      };

      summary.append(thumb, metaWrap);

      const body = document.createElement("div");
      body.className = "tag-body";

      const protectedDefault = isProtectedDefaultTag(tag);
      const grid = document.createElement("div");
      grid.className = "tag-grid";
      FIELD_META.forEach((meta) => {
        const field = document.createElement("label");
        field.className = "tag-field";
        if (meta.field === "print_size_mm") field.classList.add("span-2");
        const label = document.createElement("span");
        label.textContent = meta.label;
        const lockId = protectedDefault && meta.field === "tag_id";
        const control = makeNumInput(
          meta,
          tag[meta.field],
          (next) => {
            if (configLocked) return;
            if (lockId) return;
            const updated = cloneTag(tagConfig[stack][index]);
            updated[meta.field] = next;
            tagConfig[stack][index] = updated;
            syncThumb();
            schedulePersist();
          },
          lockId
        );
        field.append(label, control);
        grid.append(field);
      });

      const footer = document.createElement("div");
      footer.className = "tag-footer";
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn ghost tag-remove";
      removeBtn.textContent = protectedDefault ? "Default" : "Remove";
      removeBtn.disabled = protectedDefault || configLocked;
      removeBtn.title = protectedDefault
        ? "Profile default tag — cannot remove (use Restore defaults)"
        : "Remove this tag";
      removeBtn.addEventListener("click", () => {
        if (configLocked || isProtectedDefaultTag(tagConfig[stack][index])) return;
        tagConfig[stack] = tagConfig[stack].filter((_, i) => i !== index);
        if (!tagConfig[stack].length) {
          tagConfig[stack] = (defaultTagConfig[stack] || []).map((t) => cloneTag(t));
        }
        renderTagEditor();
        schedulePersist();
      });
      footer.append(removeBtn);

      body.append(grid, footer);
      card.append(summary, body);
      tagList.append(card);
      syncThumb();
    });
  }

  function describeState(status) {
    const p = status.phase || "idle";
    const stackLabel = STACK_LABELS[status.stack] || null;
    switch (p) {
      case "checking":
        return { label: "Checking setup", detail: "" };
      case "needs_setup":
        return { label: "Setup required", detail: "" };
      case "ready":
        return { label: "Ready to start", detail: "" };
      case "installing":
        return { label: "Installing", detail: "Running setup.sh…" };
      case "starting":
        return {
          label: "Starting",
          detail: stackLabel ? `Booting ${stackLabel}…` : "Booting DimOS stack…",
        };
      case "running":
        return {
          label: "Running",
          detail: stackLabel ? `${stackLabel} bridge listening` : "Bridge listening",
        };
      case "stopping":
        return { label: "Stopping", detail: "Shutting down bridge…" };
      case "error":
        return {
          label: "Error",
          detail: status.error || "Bridge failed — check the log",
        };
      case "idle":
      default:
        return { label: "Idle", detail: "" };
    }
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

  function renderLog() {
    const nearBottom =
      logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 48;
    logEl.innerHTML = logLines.map((line) => ansiToHtml(line)).join("\n");
    if (nearBottom) {
      logEl.scrollTop = logEl.scrollHeight;
    }
  }

  function appendLog(line) {
    logLines.push(line);
    renderLog();
  }

  function clearLog() {
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
    phase = status.phase || "idle";
    const info = describeState(status);
    stateValue.textContent = info.label;
    stateValue.dataset.phase = phase;
    stateDetail.textContent = info.detail;
    stateDetail.classList.toggle("hidden", !info.detail);
    setText(bridgeIp, status.spectacles_ip);
    setText(bridgeIpSummary, status.spectacles_ip);
    setText(robotValue, displayRobotIp(status.robot_ip));

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

    const needsSetup = phase === "needs_setup";
    const busy =
      phase === "checking" ||
      phase === "installing" ||
      phase === "starting" ||
      phase === "stopping";
    const running = phase === "running" || phase === "starting";
    const locked = phase === "starting" || phase === "running" || phase === "stopping";

    setupCard.classList.toggle("hidden", !needsSetup);
    controlsCard.classList.toggle("hidden", needsSetup);
    actionsBar.classList.toggle("hidden", needsSetup);

    if (status.default_clone_dir && !cloneDir.value) {
      cloneDir.value = status.default_clone_dir;
    }
    if (status.dimos_python && !dimosPython.value) {
      dimosPython.value = status.dimos_python;
    }

    startBtn.disabled = busy || running || needsSetup;
    stopBtn.disabled = false;
    stopBtn.classList.toggle(
      "danger",
      phase === "running" || phase === "starting" || phase === "stopping"
    );
    installBtn.disabled = phase === "installing" || phase === "checking";
    setConfigLocked(locked);
  }

  function syncSetupMode() {
    const mode = document.querySelector('input[name="setupMode"]:checked')?.value;
    const existing = mode === "existing";
    cloneDirField.classList.toggle("hidden", existing);
    dimosPythonField.classList.toggle("hidden", !existing);
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

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (configLocked) return;
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      stack = btn.dataset.stack;
      applyStackInfo(stack);
      renderTagEditor();
    });
  });

  addTagBtn.addEventListener("click", () => {
    if (configLocked || !tagConfigReady) return;
    const existing = tagConfig[stack] || [];
    const nextId = existing.reduce((max, t) => Math.max(max, Number(t.tag_id) || 0), -1) + 1;
    const template = existing[0]
      ? cloneTag(existing[0])
      : cloneTag(defaultTagConfig[stack][0] || { tag_id: 0, print_size_mm: 70 });
    template.tag_id = nextId;
    // Extra tags must not collide with protected profile defaults.
    while (defaultTagIds[stack].has(template.tag_id)) {
      template.tag_id += 1;
    }
    tagConfig[stack] = [...existing, template];
    renderTagEditor();
    schedulePersist();
  });

  restoreTagsBtn.addEventListener("click", async () => {
    if (configLocked) return;
    restoreTagsBtn.disabled = true;
    try {
      const res = await fetch("/api/tag-config/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stack }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        appendLog(`Restore defaults failed: ${data.detail || res.statusText}`);
        return;
      }
      applyTagConfigPayload({
        go2: data.go2,
        g1: data.g1,
        defaults: defaultTagConfig,
        default_tag_ids: {
          go2: [...defaultTagIds.go2],
          g1: [...defaultTagIds.g1],
        },
      });
    } catch (err) {
      appendLog(`Restore defaults failed: ${err}`);
    } finally {
      restoreTagsBtn.disabled = configLocked;
    }
  });

  function syncRobotIpOverride() {
    robotIpOverrideField.classList.toggle("hidden", robotIpAuto.checked);
  }
  robotIpAuto.addEventListener("change", syncRobotIpOverride);
  syncRobotIpOverride();

  document.querySelectorAll('input[name="setupMode"]').forEach((el) => {
    el.addEventListener("change", syncSetupMode);
  });
  syncSetupMode();
  initSplitter();
  applyStackInfo(stack);
  renderTagEditor();

  revealKey.addEventListener("click", () => {
    keyVisible = !keyVisible;
    apiKey.type = keyVisible ? "text" : "password";
    revealKey.textContent = keyVisible ? "Hide" : "Show";
  });

  copyLogBtn.addEventListener("click", copyLog);
  clearLogBtn.addEventListener("click", clearLog);

  installBtn.addEventListener("click", async () => {
    const mode = document.querySelector('input[name="setupMode"]:checked')?.value || "clone";
    const body =
      mode === "existing"
        ? { mode: "existing", dimos_python: dimosPython.value.trim() }
        : { mode: "clone", clone_dir: cloneDir.value.trim() };
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
      }
      if (data.phase) applyStatus(data);
    } catch (err) {
      appendLog(`Setup error: ${err}`);
    }
  });

  startBtn.addEventListener("click", async () => {
    startBtn.disabled = true;
    await persistTagConfig();
    const body = {
      stack,
      robot_ip: robotIpAuto.checked ? null : robotIp.value.trim() || null,
    };
    const typedKey = apiKey.value.trim();
    if (typedKey) {
      body.openai_api_key = typedKey;
    }
    try {
      const res = await fetch("/api/bridge/start", {
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
      if (res.ok && typedKey) {
        apiKey.value = "";
      }
    } catch (err) {
      appendLog(`Start error: ${err}`);
      startBtn.disabled = false;
    }
  });

  stopBtn.addEventListener("click", async () => {
    try {
      const res = await fetch("/api/bridge/stop", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.phase) applyStatus(data);
    } catch (err) {
      appendLog(`Stop error: ${err}`);
    }
  });

  async function loadConfig() {
    try {
      const res = await fetch("/api/tag-config");
      if (!res.ok) return;
      applyTagConfigPayload(await res.json());
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
  connectEvents();
  fetch("/api/status")
    .then((r) => r.json())
    .then(applyStatus)
    .catch(() => {});
})();
