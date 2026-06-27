const $ = (id) => document.getElementById(id);

const DEFAULT_BACKEND = "http://127.0.0.1:8077";
async function backendBase() {
  const { backend } = await chrome.storage.sync.get({ backend: DEFAULT_BACKEND });
  return backend || DEFAULT_BACKEND;
}
async function api(path, opts) {
  const r = await fetch((await backendBase()) + path, opts);
  return r.json();
}
const postConfig = (body) =>
  api("/config", { method: "POST", headers: { "Content-Type": "application/json" },
                   body: JSON.stringify(body) });

// ── extension prefs (synced) ────────────────────────────────────────────────
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

// ── AI source: maxOAuth ↔ API (backend-side, lives in ~/.lupa/config.json) ───
const toggleApiBox = () => { $("apiBox").style.display = $("authMode").value === "api" ? "block" : "none"; };

function renderKeyState(c, forceEdit) {
  const has = !!(c && c.has_key);
  const st = $("keyStatus");
  if (has) {
    st.innerHTML = `<span class="ok">✓ Cheie salvată: ${c.key_masked} · all set</span>`
                 + `<a id="changeKey">adaugă altă cheie</a>`;
    $("keyEditor").style.display = forceEdit ? "block" : "none";
    const ch = $("changeKey");
    if (ch) ch.addEventListener("click", () => {
      $("keyEditor").style.display = "block";
      $("apiKey").focus();
    });
  } else {
    st.innerHTML = `<span class="bad">✕ Nicio cheie salvată</span>`;
    $("keyEditor").style.display = "block";
  }
}

function applyConfig(c) {
  if (!c || c.ok === false) return;
  $("authMode").value = c.auth_mode === "api" ? "api" : "oauth";
  toggleApiBox();
  renderKeyState(c, false);
}

$("authMode").addEventListener("change", async (e) => {
  toggleApiBox();
  applyConfig(await postConfig({ auth_mode: e.target.value }));
  refreshHealth();
});

$("saveKey").addEventListener("click", async () => {
  const k = $("apiKey").value.trim();
  if (!k) { $("keyHint").textContent = "Lipsește cheia."; return; }
  $("saveKey").disabled = true;
  $("keyHint").textContent = "Salvez…";
  const c = await postConfig({ api_key: k, auth_mode: "api" });
  $("apiKey").value = "";
  $("saveKey").disabled = false;
  $("keyHint").textContent = "Cheia rămâne doar pe calculatorul tău.";
  applyConfig(c);   // key present -> editor collapses, green ✓ shows
  refreshHealth();
});

// ── backend health ──────────────────────────────────────────────────────────
function refreshHealth() {
  chrome.runtime.sendMessage({ type: "health" }, (resp) => {
    const el = $("status");
    if (resp && resp.ok && resp.data && resp.data.ok) {
      const d = resp.data;
      el.className = "status ok";
      const short = (m) => (m || "").replace("claude-", "").replace(/-\d+$/, "");
      const ex = short(d.model);
      const qz = short(d.quiz_model || d.model);
      const models = ex === qz ? ex : `explică ${ex} · grile ${qz}`;
      const src = d.auth === "api" ? "API" : "maxOAuth";
      el.innerHTML = `✓ Backend pornit · ${d.chunks} fragmente neuro · ${models} · <b>${src}</b>`;
    } else {
      el.className = "status bad";
      el.innerHTML = `✕ Backend oprit. Rulează în terminal:<br><code>~/PROJECTS/study-lens/backend/run.sh</code>`;
    }
  });
}

// init: load saved AI-source config, then health
(async () => {
  try { applyConfig(await api("/config")); } catch (e) { /* backend down -> health shows it */ }
  refreshHealth();
})();
