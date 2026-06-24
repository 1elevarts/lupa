// Service worker: proxies /explain calls to the local backend (extension context
// is not subject to page CSP) and relays the toggle/explain hotkeys to the page.

try { importScripts("hotreload.js"); } catch (e) { /* dev hot-reload optional */ }

const DEFAULT_BACKEND = "http://127.0.0.1:8077";

async function backendBase() {
  const { backend } = await chrome.storage.sync.get({ backend: DEFAULT_BACKEND });
  return backend || DEFAULT_BACKEND;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "explain") {
    (async () => {
      try {
        const base = await backendBase();
        const r = await fetch(base + "/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(msg.payload || {}),
        });
        const data = await r.json();
        sendResponse({ ok: true, data });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // async response
  }
  if (msg && msg.type === "health") {
    (async () => {
      try {
        const base = await backendBase();
        const r = await fetch(base + "/health");
        sendResponse({ ok: true, data: await r.json() });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "command", command }).catch(() => {});
});
