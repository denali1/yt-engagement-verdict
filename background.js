/**
 * background.js
 * YT Engagement Verdict — Background Script
 *
 * Responsibilities:
 *   1. On first install, open the welcome/opt-in tab
 *   2. Programmatically inject content scripts on YouTube watch pages
 *      to ensure cold browser load works without requiring a refresh
 *   3. If scripts are already injected, trigger a navigation reset instead
 *      of re-injecting to avoid const redeclaration errors
 */

"use strict";

// On first install, open welcome tab
browser.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    browser.tabs.create({
      url: browser.runtime.getURL("welcome.html")
    });
  }
});

// Inject content scripts programmatically when a YouTube watch page loads
const injectingTabs = new Set();

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.status !== "complete" ||
    !tab.url ||
    !tab.url.includes("youtube.com/watch") ||
    injectingTabs.has(tabId)
  ) {
    return;
  }

  injectingTabs.add(tabId);

  // First check if scripts are already running in this tab
  browser.tabs.executeScript(tabId, {
    code: "typeof YTVerdict !== 'undefined'"
  }).then(results => {
    if (results && results[0] === true) {
      // Scripts already loaded — just trigger a navigation reset
      return browser.tabs.executeScript(tabId, {
        code: "window.dispatchEvent(new Event('yt-navigate-finish'));"
      });
    }

    // Fresh injection needed
    const scripts = ["verdict.js", "ryd.js", "reporter.js", "content.js"];
    return scripts.reduce((chain, script) => {
      return chain.then(() => browser.tabs.executeScript(tabId, { file: script }));
    }, Promise.resolve())
      .then(() => browser.tabs.insertCSS(tabId, { file: "styles.css" }));
  }).catch(() => {}).finally(() => {
    injectingTabs.delete(tabId);
  });
});

browser.tabs.onRemoved.addListener((tabId) => {
  injectingTabs.delete(tabId);
});
