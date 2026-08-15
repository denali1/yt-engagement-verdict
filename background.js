/**
 * background.js
 * YT Engagement Verdict — Background Script
 *
 * Responsibilities:
 *   1. On first install, open the welcome/opt-in tab
 *   2. Programmatically inject content scripts on YouTube watch pages
 *      to ensure cold browser load works without requiring a refresh
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
// This is the reliable fix for cold browser load — doesn't depend on
// document_idle timing or YouTube's SPA events
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.status === "complete" &&
    tab.url &&
    tab.url.includes("youtube.com/watch")
  ) {
    // Check if our widget is already injected
    browser.tabs.executeScript(tabId, {
      code: "document.getElementById('ytev-widget') !== null"
    }).then(results => {
      if (results && results[0] === true) return; // Already injected

      // Inject our scripts in order
      const scripts = ["verdict.js", "ryd.js", "reporter.js", "content.js"];
      scripts.reduce((chain, script) => {
        return chain.then(() => browser.tabs.executeScript(tabId, { file: script }));
      }, Promise.resolve());

      // Inject CSS
      browser.tabs.insertCSS(tabId, { file: "styles.css" });

    }).catch(() => {
      // Tab may not be ready yet — ignore
    });
  }
});
