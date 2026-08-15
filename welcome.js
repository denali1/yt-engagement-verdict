"use strict";

async function setOptIn(value) {
  await browser.storage.local.set({ telemetry_opted_in: value });

  document.getElementById("buttons").hidden = true;
  const confirmed = document.getElementById("confirmed");
  confirmed.hidden = false;

  if (value) {
    document.getElementById("confirmed-title").textContent = "Thanks for helping out.";
    document.getElementById("confirmed-body").textContent = "Your verdict data will be shared anonymously. You can turn this off anytime in the popup.";
  } else {
    document.getElementById("confirmed-title").textContent = "No problem.";
    document.getElementById("confirmed-body").textContent = "The extension works great locally. You can always opt in later from the popup.";
  }

  setTimeout(() => window.close(), 3000);

  // window.close() only works on tabs this script opened. If the browser
  // refused (tab opened directly), don't strand the user on a frozen page —
  // bounce them to YouTube instead.
  setTimeout(() => {
    if (!window.closed) {
      window.location.replace("https://www.youtube.com");
    }
  }, 4000);
}

document.getElementById("btn-yes").addEventListener("click", () => setOptIn(true));
document.getElementById("btn-no").addEventListener("click", () => setOptIn(false));
