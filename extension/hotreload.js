// Dev hot-reload. Polls the extension's own packaged files (read fresh from disk
// for UNPACKED extensions); when any change, reloads open tabs so content.js
// re-injects, then reloads the extension itself. No-op effect in a store build.
const HR_FILES = ["content.js", "background.js", "popup.js", "popup.html", "manifest.json"];
const HR_ALARM = "lupa-hotreload";
let hrSig = null;

function hrHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}

async function hrSnapshot() {
  const parts = await Promise.all(
    HR_FILES.map(async (f) => {
      try {
        const r = await fetch(chrome.runtime.getURL(f), { cache: "no-store" });
        return f + ":" + hrHash(await r.text());
      } catch {
        return f + ":missing";
      }
    })
  );
  return parts.join("|");
}

async function hrCheck() {
  const cur = await hrSnapshot();
  if (hrSig === null) { hrSig = cur; return; }
  if (cur === hrSig) return;
  hrSig = cur;
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (t.id && /^(https?|file):/.test(t.url || "")) {
      chrome.tabs.reload(t.id).catch(() => {});
    }
  }
  chrome.runtime.reload();
}

chrome.alarms.create(HR_ALARM, { periodInMinutes: 0.05 }); // ~3s (unpacked allows sub-minute)
chrome.alarms.onAlarm.addListener((a) => { if (a.name === HR_ALARM) hrCheck(); });
hrCheck(); // prime the signature on SW startup
