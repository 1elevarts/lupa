const $ = (id) => document.getElementById(id);

chrome.storage.sync.get(
  { enabled: true, mode: "auto", scan: false, autoQuestion: false, barOpacity: 0.4 },
  (cfg) => {
    $("enabled").checked = cfg.enabled;
    $("mode").value = cfg.mode;
    $("scan").checked = cfg.scan;
    $("autoQuestion").checked = cfg.autoQuestion;
    $("barOpacity").value = cfg.barOpacity;
    $("barOpacityVal").textContent = Number(cfg.barOpacity).toFixed(2);
  }
);

$("enabled").addEventListener("change", (e) => chrome.storage.sync.set({ enabled: e.target.checked }));
$("mode").addEventListener("change", (e) => chrome.storage.sync.set({ mode: e.target.value }));
$("scan").addEventListener("change", (e) => chrome.storage.sync.set({ scan: e.target.checked }));
$("autoQuestion").addEventListener("change", (e) => chrome.storage.sync.set({ autoQuestion: e.target.checked }));
$("barOpacity").addEventListener("input", (e) => {
  const v = Number(e.target.value);
  $("barOpacityVal").textContent = v.toFixed(2);
  chrome.storage.sync.set({ barOpacity: v });
});

// backend health
chrome.runtime.sendMessage({ type: "health" }, (resp) => {
  const el = $("status");
  if (resp && resp.ok && resp.data && resp.data.ok) {
    el.className = "status ok";
    const short = (m) => (m || "").replace("claude-", "").replace(/-\d+$/, "");
    const ex = short(resp.data.model);
    const qz = short(resp.data.quiz_model || resp.data.model);
    const models = ex === qz ? ex : `explică ${ex} · grile ${qz}`;
    el.innerHTML = `✓ Backend pornit · ${resp.data.chunks} fragmente neuro · ${models}`;
  } else {
    el.className = "status bad";
    el.innerHTML = `✕ Backend oprit. Rulează în terminal:<br><code>~/PROJECTS/study-lens/backend/run.sh</code>`;
  }
});
