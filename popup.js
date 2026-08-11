"use strict";

(function () {

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function dotClass(score) {
    if (score === 2) return "dot-high";
    if (score === 1) return "dot-mid";
    return "dot-low";
  }

  function barColor(score, max) {
    const pct = score / max;
    if (pct <= 0.20) return "#ff4444";
    if (pct <= 0.55) return "#ff8c00";
    if (pct <= 0.90) return "#4caf50";
    return "#ff6b35";
  }

  function formatNum(n) {
    if (n === null || n === undefined) return "—";
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
    if (n >= 1_000_000)     return (n / 1_000_000).toFixed(2) + "M";
    if (n >= 1_000)         return (n / 1_000).toFixed(1) + "K";
    return n.toLocaleString();
  }

  function formatRate(r) {
    if (r === null || r === undefined) return "—";
    return (r * 100).toFixed(3) + "%";
  }

  /** Create an element with optional className and textContent */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function setVersionLabel(version, source) {
    const node = document.getElementById("selector-version");
    if (!node) return;
    const sourceLabel = source === "remote" ? "↑ live" : source === "cached" ? "cached" : "fallback";
    node.textContent = `Selectors v${version} (${sourceLabel})`;
    node.style.color = source === "fallback" ? "#ff8c00" : "#555";
  }

  // ─── Render verdict display ───────────────────────────────────────────────

  function renderVerdict(display, response) {
    const { verdict, composite, maxScore, signals, inputs } = response;
    const pct = Math.round((composite / maxScore) * 100);

    // Verdict row
    const verdictRow = el("div", "verdict-row");
    verdictRow.appendChild(el("span", "verdict-emoji", verdict.emoji));
    const labelSpan = el("span", "verdict-label", verdict.label);
    labelSpan.style.color = verdict.color;
    verdictRow.appendChild(labelSpan);
    display.appendChild(verdictRow);

    // Score line
    display.appendChild(el("div", "score-line", `${composite}/${maxScore} signals · ${pct}%`));

    // Bar
    const barWrap = el("div", "bar-wrap");
    const barFill = el("div", "bar-fill");
    barFill.style.width = `${pct}%`;
    barFill.style.background = barColor(composite, maxScore);
    barWrap.appendChild(barFill);
    display.appendChild(barWrap);

    // Description
    const desc = el("p", null, verdict.description);
    desc.style.cssText = "font-size:12px; color:#ccc; margin-bottom:10px;";
    display.appendChild(desc);

    // Signal list
    const ul = el("ul", "signal-list");
    signals.forEach(s => {
      const li = document.createElement("li");

      const dot = el("span", `dot ${dotClass(s.score)}`);
      li.appendChild(dot);

      const text = document.createElement("span");
      const rateText = document.createTextNode(`${s.name}: ${formatRate(s.rate)} `);
      text.appendChild(rateText);

      const expected = el("span", null, `(expected ${formatRate(s.expected.low)}–${formatRate(s.expected.high)})`);
      expected.style.color = "#666";
      text.appendChild(expected);

      li.appendChild(text);
      ul.appendChild(li);
    });
    display.appendChild(ul);

    // Stats row
    const stats = el("div");
    stats.style.cssText = "font-size:11px; color:#888; margin-top:6px;";
    let statsText = `Views: ${formatNum(inputs.views)} · Likes: ${formatNum(inputs.likes)} · Comments: ${formatNum(inputs.comments)}`;
    if (inputs.dislikes !== null) statsText += ` · Dislikes: ${formatNum(inputs.dislikes)}`;
    stats.textContent = statsText;
    display.appendChild(stats);
  }

  // ─── Telemetry toggle ───────────────────────────────────────────────

  const toggle = document.getElementById("telemetry-toggle");
  const toggleLabel = document.getElementById("telemetry-label");

  // Load current opt-in state
  browser.storage.local.get("telemetry_opted_in").then(result => {
    const optedIn = result.telemetry_opted_in === true;
    toggle.checked = optedIn;
    toggleLabel.textContent = optedIn ? "On" : "Off";
    toggleLabel.style.color = optedIn ? "#4caf50" : "#555";
  }).catch(() => {});

  // Save on change
  toggle.addEventListener("change", () => {
    const optedIn = toggle.checked;
    browser.storage.local.set({ telemetry_opted_in: optedIn });
    toggleLabel.textContent = optedIn ? "On" : "Off";
    toggleLabel.style.color = optedIn ? "#4caf50" : "#555";
  });

  // ─── Get active tab ───────────────────────────────────────────────────────

  browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
    const tab = tabs[0];
    const isYouTubeVideo = tab && tab.url && tab.url.includes("youtube.com/watch");

    // Selector version display
    if (isYouTubeVideo) {
      browser.tabs.sendMessage(tab.id, { type: "GET_SELECTOR_VERSION" })
        .then(res => {
          if (res && res.version) setVersionLabel(res.version, res.source || "cached");
        })
        .catch(() => {});
    }

    // Refresh button
    const refreshBtn = document.getElementById("refresh-selectors");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        if (!isYouTubeVideo) return;
        refreshBtn.textContent = "…";
        refreshBtn.disabled = true;
        browser.tabs.sendMessage(tab.id, { type: "FORCE_SELECTOR_REFRESH" })
          .then(res => {
            refreshBtn.textContent = "↻ Refresh";
            refreshBtn.disabled = false;
            if (res && res.version) setVersionLabel(res.version, "remote");
          })
          .catch(() => {
            refreshBtn.textContent = "↻ Refresh";
            refreshBtn.disabled = false;
          });
      });
    }

    if (!isYouTubeVideo) return;

    // Verdict display
    browser.tabs.sendMessage(tab.id, { type: "GET_VERDICT" }).then(response => {
      if (!response || !response.verdict) {
        document.getElementById("status").textContent =
          "No verdict yet — the video may still be loading.";
        return;
      }

      document.getElementById("status").hidden = true;
      const display = document.getElementById("verdict-display");
      display.hidden = false;

      renderVerdict(display, response);

    }).catch(() => {
      document.getElementById("status").textContent =
        "Could not reach the page. Try refreshing the YouTube tab.";
    });
  });

})();
