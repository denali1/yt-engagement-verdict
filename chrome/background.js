/**
 * chrome/background.js
 * YT Engagement Verdict — Chrome MV3 Background Service Worker
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
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({
      url: chrome.runtime.getURL("welcome.html")
    });
  }
});

// Inject content scripts programmatically when a YouTube watch page loads
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.status === "complete" &&
    tab.url &&
    tab.url.includes("youtube.com/watch")
  ) {
    // First check if scripts are already running in this tab
    chrome.scripting.executeScript({
      target: { tabId },
      func: () => typeof YTVerdict !== "undefined"
    }).then(results => {
      if (results && results[0]?.result === true) {
        // Scripts already loaded — just trigger a navigation reset
        chrome.scripting.executeScript({
          target: { tabId },
          func: () => window.dispatchEvent(new Event("yt-navigate-finish"))
        });
      } else {
        // Fresh injection needed
        ["verdict.js", "ryd.js", "reporter.js", "content.js"].reduce((chain, script) => {
          return chain.then(() => chrome.scripting.executeScript({
            target: { tabId },
            files: [script]
          }));
        }, Promise.resolve());

        chrome.scripting.insertCSS({
          target: { tabId },
          files: ["styles.css"]
        });
      }
    }).catch(() => {});
  }
});
