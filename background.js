/**
 * background.js
 * YT Engagement Verdict — Background Script
 *
 * Responsibilities:
 *   1. On first install, open the welcome/opt-in tab
 *   2. Listen for opt-in preference changes from the welcome page
 */

"use strict";

browser.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    browser.tabs.create({
      url: browser.runtime.getURL("welcome.html")
    });
  }
});
