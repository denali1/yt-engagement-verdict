"use strict";

(function () {

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

  function setVersionLabel(version, source) {
    const el = document.getElementById("selector-version");
    if (!el) return;
    const sourceLabel = source === "remote" ? "↑ live" : source === "cached" ? "cached" : "fallback";
    el.textContent = `Selectors v${version} (${sourceLabel})`;
    el.style.color = source === "fallback" ? "#ff8c00" : "#555";
  }

  // ─── Get active tab ───────────────────────────────────────────────────────

  browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
    const tab = tabs[0];
    const isYouTubeVideo = tab && tab.url && tab.url.includes("youtube.com/watch");

    // ── Selector version display ──
    if (isYouTubeVideo) {
      browser.tabs.sendMessage(tab.id, { type: "GET_SELECTOR_VERSION" })
        .then(res => {
          if (res && res.version) setVersionLabel(res.version, res.source || "cached");
        })
        .catch(() => {});
    }

    // ── Refresh button ──
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

    // ── Verdict display ──
    if (!isYouTubeVideo) return;

    browser.tabs.sendMessage(tab.id, { type: "GET_VERDICT" }).then(response => {
      if (!response || !response.verdict) {
        document.getElementById("status").textContent =
          "No verdict yet — the video may still be loading.";
        return;
      }

      const { verdict, composite, maxScore, signals, inputs } = response;

      document.getElementById("status").hidden = true;
      const display = document.getElementById("verdict-display");
      display.hidden = false;

      const pct = Math.round((composite / maxScore) * 100);

      display.innerHTML = `
        <div class="verdict-row">
          <span class="verdict-emoji">${verdict.emoji}</span>
          <span class="verdict-label" style="color:${verdict.color}">${verdict.label}</span>
        </div>
        <div class="score-line">${composite}/${maxScore} signals · ${pct}%</div>
        <div class="bar-wrap">
          <div class="bar-fill" style="width:${pct}%; background:${barColor(composite, maxScore)}"></div>
        </div>
        <p style="font-size:12px; color:#ccc; margin-bottom:10px;">${verdict.description}</p>
        <ul class="signal-list">
          ${signals.map(s => `
            <li>
              <span class="dot ${dotClass(s.score)}"></span>
              <span>${s.name}: ${formatRate(s.rate)}
                <span style="color:#666;">(expected ${formatRate(s.expected.low)}–${formatRate(s.expected.high)})</span>
              </span>
            </li>
          `).join("")}
        </ul>
        <div style="font-size:11px; color:#888; margin-top:6px;">
          Views: ${formatNum(inputs.views)} &nbsp;·&nbsp;
          Likes: ${formatNum(inputs.likes)} &nbsp;·&nbsp;
          Comments: ${formatNum(inputs.comments)}
          ${inputs.dislikes !== null ? `&nbsp;·&nbsp; Dislikes: ${formatNum(inputs.dislikes)}` : ""}
        </div>
      `;
    }).catch(() => {
      document.getElementById("status").textContent =
        "Could not reach the page. Try refreshing the YouTube tab.";
    });
  });

})();
