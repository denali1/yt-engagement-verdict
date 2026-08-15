/**
 * chrome/background.js
 * YT Engagement Verdict — Chrome MV3 Background Service Worker
 *
 * Responsibilities:
 *   1. On first install, open the welcome/opt-in tab
 *   2. Programmatically inject content scripts on YouTube watch pages
 *      to ensure cold browser load works without requiring a refresh
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
    // Check if our widget is already injected
    chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.getElementById("ytev-widget") !== null
    }).then(results => {
      if (results && results[0]?.result === true) return; // Already injected

      // Inject scripts in order
      ["verdict.js", "ryd.js", "reporter.js", "content.js"].reduce((chain, script) => {
        return chain.then(() => chrome.scripting.executeScript({
          target: { tabId },
          files: [script]
        }));
      }, Promise.resolve());

      // Inject CSS
      chrome.scripting.insertCSS({
        target: { tabId },
        files: ["styles.css"]
      });

    }).catch(() => {});
  }
});
