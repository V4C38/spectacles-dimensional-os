export function logConsole({ logEl, logFilterLevel, logFilterSource, copyLogBtn }) {
  const MAX_LOG_LINES = 5000;
  const logLines = [];
  const pendingLines = [];
  let frameHandle = null;
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
    } else {
      if (!/^\s|^(Traceback|Caused by:)/.test(plain)) lastLevel = "info";
      if (AR_RE.test(plain)) lastAr = true;
    }
    const error = /\b(error|failed|failure|unavailable|not found)\b/i.test(plain);
    const connected = !error && !/\b(disconnected|not connected|connecting)\b/i.test(plain) &&
      /\b(connected|connection established|CAN ready|bus ready)\b/i.test(plain);
    if (error) lastLevel = "error";
    else if (connected) lastLevel = "info";
    return { level: lastLevel, ar: lastAr,
      tone: error || lastLevel === "error" ? "error" : connected ? "success" : "normal" };
  }

  function lineVisible(entry) {
    const min = LEVEL_RANK[logFilterLevel.value] ?? 0;
    if (LEVEL_RANK[entry.level] < min) return false;
    return !(logFilterSource.value === "ar" && !entry.ar);
  }

  function makeLogLineEl(entry) {
    const el = document.createElement("div");
    el.className = "log-line";
    el.dataset.tone = entry.tone;
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

  return { appendLog, clearLog, copyLog, applyLogFilter };
}
