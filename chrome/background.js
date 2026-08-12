/**
 * chrome/background.js
 * YT Engagement Verdict — Chrome MV3 Background Service Worker
 *
 * Differences from Firefox MV2 background.js:
 *   - Uses chrome.* API instead of browser.*
 *   - Runs as a service worker (not a persistent background page)
 *   - No persistent state between events
 */

"use strict";

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({
      url: chrome.runtime.getURL("welcome.html")
    });
  }
});
