/* Lupa — AR study tutor lens.
 * A frosted magnifier sits fixed in the bottom-right corner. Click it (or press
 * Alt+L, or hover-hold in scan mode) -> it asks the local backend and shows a
 * grounded hint as a subtle info bar at the bottom of the page.
 * When you pick a quiz answer it checks it: wrong -> "think again" + a fresh hint;
 * right -> a short confirmation. It TEACHES the concept, never reveals the answer.
 */
(() => {
  if (window.__eLupaLoaded) return;
  window.__eLupaLoaded = true;

  const S = {
    enabled: true,
    mode: "auto",     // auto | explain | quiz | write
    scan: false,      // hover-hold to explain
    autoQuestion: false, // auto-explain the visible quiz question as it changes
    accent: "#7c5cff",
    cursor: { x: innerWidth / 2, y: innerHeight / 2 },
    lastEl: null,     // last page element the cursor was over (not our UI)
    state: "idle",    // idle | armed | thinking | ready | error
    lastSel: "",
    lastAutoQ: "",    // text of the last auto-explained question (dedupe)
    hlEl: null,       // element currently framed by the highlight
    hlSrc: null,      // source element of the current explanation (for dim scoping)
    dimEls: [],       // overlay bars drawn over excluded options
    barExpanded: false, // H toggles the full text under the peek
    panelOpen: false,
    hoverTimer: null,
    autoTimer: null,
  };

  /* ---------- shadow UI ---------- */
  const host = document.createElement("div");
  host.id = "elupa-host";
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
  (document.documentElement || document.body).appendChild(host);
  const root = host.attachShadow({ mode: "open" });

  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; }
      /* fixed hover zone that never moves -> no jitter when the orb slides out */
      .orbzone { position: fixed; right: 0; bottom: 8px; width: 54px; height: 58px;
                 pointer-events: auto; z-index: 2; }
      .orb {
        position: absolute; right: -17px; bottom: 10px; width: 34px; height: 34px;
        border-radius: 50%; pointer-events: auto; cursor: pointer;
        background: radial-gradient(circle at 35% 30%, rgba(255,255,255,.6), rgba(255,255,255,.1) 60%);
        backdrop-filter: blur(6px) saturate(1.4); -webkit-backdrop-filter: blur(6px) saturate(1.4);
        border: 1.5px solid var(--accent, #7c5cff);
        box-shadow: 0 6px 22px rgba(40,20,90,.32), inset 0 0 12px rgba(255,255,255,.28);
        opacity: .15; transition: opacity .25s, right .2s ease, transform .18s, border-color .3s, box-shadow .3s;
        display: grid; place-items: center;
      }
      /* only a real hover over the (stationary) zone reveals it */
      .orbzone:hover .orb { opacity: 1; right: 10px; transform: scale(1.06); }
      .orb:active { transform: scale(.94); }
      .orb svg { width: 16px; height: 16px; stroke: var(--accent,#7c5cff); opacity:.95; }
      /* working/ready: change colour only — stays hidden until hovered */
      .orb.armed   { transform: scale(1.04); }
      .orb.thinking{ border-color:#f5a623; box-shadow:0 6px 22px rgba(245,166,35,.4), inset 0 0 14px rgba(255,255,255,.3); }
      .orb.thinking::after{
        content:""; position:absolute; inset:-4px; border-radius:50%;
        background: conic-gradient(from 0deg, transparent, #f5a623, transparent 60%);
        -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 0);
                mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 0);
        animation: spin .9s linear infinite;
      }
      .orb.ready   { border-color:#34d399; box-shadow:0 6px 24px rgba(52,211,153,.45), inset 0 0 14px rgba(255,255,255,.3); }
      .orb.error   { border-color:#ef4444; }
      @keyframes spin { to { transform: rotate(360deg); } }

      /* ---- highlight frame around the question the lens is helping with ---- */
      .hl { position: fixed; pointer-events: none; border: 1px solid rgba(120,122,140,.4);
        border-radius: 10px; opacity: 0; z-index: 1;
        box-shadow: 0 0 0 2px rgba(120,122,140,.07);
        transition: opacity .2s, top .12s, left .12s, width .12s, height .12s; }
      .hl.show { opacity: .85; }
      /* red bar overlaid on the left edge of an excluded option (no page edits) */
      /* thin colour bar overlaid on the left edge of an option (no page edits) */
      .dimbar { position: fixed; width: 1px; border-radius: 2px; pointer-events: none;
        z-index: 1; transition: opacity .2s; }
      .dimbar.red   { background: rgba(214,69,69,.75); }
      .dimbar.green { width: 2px; background: rgba(74,190,124,.6); }
      .dimbar.grey  { background: rgba(150,150,165,.75); }

      /* ---- info bar at the bottom: light, translucent, clears on hover ---- */
      .panel {
        position: fixed; left: 18px; right: 70px; bottom: 16px; pointer-events: auto;
        display: block;
        background: rgba(248,247,251,.32); color: #211e33;
        backdrop-filter: blur(8px) saturate(1.05); -webkit-backdrop-filter: blur(8px) saturate(1.05);
        border: 1px solid rgba(20,16,40,.06); border-radius: 14px;
        box-shadow: 0 6px 20px rgba(20,10,50,.07);
        padding: 12px 38px 12px 16px; opacity: 0; transform: translateY(8px);
        transition: opacity .2s ease, transform .2s cubic-bezier(.2,.9,.3,1),
                    background .3s ease, box-shadow .3s ease, backdrop-filter .3s ease;
        font-size: 13.5px; line-height: 1.5;
      }
      .panel.show { opacity: var(--bar-op, .4); transform: translateY(0); }
      .panel.show:hover { opacity: 1; background: rgba(253,252,255,.98);
        backdrop-filter: blur(16px) saturate(1.3); -webkit-backdrop-filter: blur(16px) saturate(1.3);
        box-shadow: 0 12px 40px rgba(20,10,50,.26); }
      .p-main { flex: 1 1 58%; min-width: 260px; }
      .p-side { flex: 1 1 30%; min-width: 200px; }
      /* auto-hide layout: peek (balance/title) always visible, full body toggled by H */
      .p-peek { display:flex; align-items:center; justify-content:center; gap:10px; position:relative; min-height:22px; padding-right:26px; }
      .p-peek .p-fader, .p-peek .p-faders { width:100%; }
      .p-peektitle { display:flex; align-items:center; gap:8px; font-weight:700; font-size:13px; color:#171527; }
      .p-toggle { position:absolute; right:0; top:50%; transform:translateY(-50%);
                  font-size:10px; font-weight:700; color:#9b99ab; border:1px solid rgba(20,16,40,.16);
                  border-radius:6px; padding:1px 6px; cursor:pointer; line-height:1.4; }
      .p-toggle:hover { color:#3a3640; border-color:rgba(20,16,40,.32); }
      .p-full { max-height:0; overflow:hidden; opacity:0;
                transition:max-height .25s ease, opacity .2s ease, margin-top .2s ease, padding-top .2s ease; }
      .panel.expanded .p-full { max-height:60vh; overflow:auto; opacity:1; margin-top:10px;
                padding-top:10px; border-top:1px solid rgba(20,16,40,.07); }
      .panel.expanded .p-peektitle { display:none; }
      .p-head { display:flex; align-items:center; gap:8px; margin-bottom:5px; }
      .p-dot { width:8px;height:8px;border-radius:50%;background:var(--accent,#7c5cff);
               box-shadow:0 0 8px rgba(124,92,255,.5); flex:0 0 auto;}
      .p-title { font-weight:700; font-size:13px; letter-spacing:.2px; color:#171527; }
      .p-mode { margin-left:auto; font-size:10px; text-transform:uppercase; letter-spacing:.6px;
                color:#6b5fae; background:rgba(124,92,255,.14); padding:2px 8px; border-radius:20px; }
      .p-verdict { font-size:12px; font-weight:700; padding:3px 9px; border-radius:20px; margin-bottom:7px;
                   display:inline-block; }
      .p-verdict.wrong { color:#9a3412; background:rgba(245,166,35,.18); border:1px solid rgba(245,130,35,.3); }
      .p-verdict.ok    { color:#15803d; background:rgba(52,211,153,.18); border:1px solid rgba(52,180,120,.3); }
      .p-multi { display:inline-block; font-size:12px; font-weight:700; padding:3px 10px;
                 border-radius:20px; margin-bottom:7px; color:#1e40af;
                 background:rgba(59,130,246,.14); border:1px solid rgba(59,130,246,.32); }
      .p-body { color:#2a2740; }
      /* DJ crossfader (single-answer) — compact, decks hugging the track */
      .p-fader { width:100%; }
      .f-row { display:flex; align-items:center; justify-content:center; gap:8px; }
      .f-deck { flex:0 1 auto; max-width:34%; min-width:0; font-size:11px; color:#9a98aa; text-align:center;
                overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }      /* gri = mai puțin probabil */
      .f-deck.fav { color:#1f9d57; font-weight:700; }                                /* verde = spre care înclină */
      .f-track { flex:0 0 118px; height:5px; border-radius:5px; position:relative;
                 background:linear-gradient(90deg, rgba(120,122,140,.2), rgba(120,122,140,.07) 50%, rgba(120,122,140,.2)); }
      .f-mid { position:absolute; left:50%; top:-3px; width:1px; height:11px; background:rgba(20,16,40,.2); }
      .f-knob { position:absolute; top:50%; width:6px; height:15px; border-radius:3px;
                background:#2e9e63; transform:translate(-50%,-50%);
                box-shadow:0 1px 4px rgba(46,158,99,.5); transition:left .35s cubic-bezier(.2,.9,.3,1); }
      .b-cap { font-size:10px; color:#9b99ab; text-align:center; margin-top:4px; }
      /* level faders (multi-answer) — slider first, then option; original order; centered & small */
      .p-faders { display:flex; flex-direction:column; gap:6px; width:100%; align-items:center; }
      .m-slider { display:flex; align-items:center; gap:8px; max-width:100%; }
      .m-track { flex:0 0 84px; height:6px; border-radius:6px; background:rgba(20,16,40,.08); overflow:hidden; }
      .m-fill { height:100%; border-radius:6px; background:var(--accent,#7c5cff); transition:width .35s ease; }
      .m-fill.hot  { background:#34b37a; }
      .m-fill.cold { background:#cfccdd; }
      .m-pct { flex:0 0 34px; font-size:10.5px; font-weight:700; color:#5a5870; text-align:right; }
      .m-lbl { flex:0 1 auto; min-width:0; font-size:11px; color:#4a4763;
               overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .p-keys { display:flex; flex-wrap:wrap; gap:6px; margin-top:9px; }
      .p-key { font-size:11px; background:rgba(124,92,255,.12); color:#5a4db0; padding:3px 9px;
               border-radius:20px; border:1px solid rgba(124,92,255,.22); }
      .p-elims { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }
      .p-elim { font-size:12px; color:#3a3640; background:transparent;
                border:1px solid rgba(214,69,69,.55); padding:3px 11px; border-radius:18px;
                cursor:help; }
      .p-elim b { color:#c0392b; font-weight:700; }
      .p-hint { display:flex; gap:7px; align-items:flex-start;
                font-size:12.5px; color:#3a3640; background:transparent;
                border:1px solid rgba(245,166,35,.5); border-radius:10px; padding:8px 10px; }
      .p-hint svg { flex:0 0 auto; margin-top:1px; }
      .p-foot { margin-top:9px; display:flex; align-items:center; gap:8px;
                font-size:11px; color:#736e92; }
      .p-src { color:#6b5fae; text-decoration:none; border-bottom:1px dotted #a99cff; }
      .p-src:hover { color:#4a3da0; }
      .p-x { position:absolute; top:8px; right:12px; cursor:pointer; color:#9a93b8;
             font-size:16px; line-height:1; }
      .p-x:hover { color:#211e33; }
      .p-loading { display:flex; gap:9px; align-items:center; color:#4a4663; font-size:13px; }
      .shimmer { width:14px;height:14px;border-radius:50%;border:2px solid rgba(124,92,255,.3);
                 border-top-color:#7c5cff; animation:spin .8s linear infinite; }

      .toast { position:fixed; bottom:64px; left:50%; transform:translateX(-50%);
               background:rgba(20,18,32,.95); color:#fff; padding:10px 15px; border-radius:12px;
               font-size:12.5px; pointer-events:auto; border:1px solid rgba(255,255,255,.12);
               box-shadow:0 12px 36px rgba(0,0,0,.4); max-width:420px; opacity:0; transition:opacity .2s; }
      .toast.show { opacity:1; }
      .toast b { color:#ffd9a8; }
      kbd { background:rgba(255,255,255,.14); border-radius:5px; padding:1px 5px; font-size:11px; }
    </style>
    <div class="orbzone" id="orbzone">
      <div class="orb" id="orb" title="Lupa — click ca să-ți explic selecția / paragraful">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round">
          <circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path>
        </svg>
      </div>
    </div>
    <div class="hl" id="hl"></div>
    <div class="panel" id="panel"></div>
    <div class="toast" id="toast"></div>
  `;

  const orb = root.getElementById("orb");
  const orbzone = root.getElementById("orbzone");
  const panel = root.getElementById("panel");
  const toast = root.getElementById("toast");
  const hl = root.getElementById("hl");
  host.style.setProperty("--accent", S.accent);

  /* ---------- load settings ---------- */
  chrome.storage?.sync.get(
    { enabled: true, mode: "auto", scan: false, autoQuestion: false, barOpacity: 0.4, accent: "#7c5cff" },
    (cfg) => { Object.assign(S, cfg); applyAccent(S.accent); setBarOpacity(S.barOpacity); reflectEnabled(); reflectAuto(); }
  );
  chrome.storage?.onChanged.addListener((ch) => {
    if (ch.enabled) { S.enabled = ch.enabled.newValue; reflectEnabled(); reflectAuto(); }
    if (ch.mode) S.mode = ch.mode.newValue;
    if (ch.scan) S.scan = ch.scan.newValue;
    if (ch.autoQuestion) { S.autoQuestion = ch.autoQuestion.newValue; reflectAuto(); }
    if (ch.barOpacity) setBarOpacity(ch.barOpacity.newValue);
    if (ch.accent) { S.accent = ch.accent.newValue; applyAccent(S.accent); }
  });
  function applyAccent(c) { orb.style.setProperty("--accent", c); panel.style.setProperty("--accent", c); }
  function setBarOpacity(v) {
    const n = Math.min(0.8, Math.max(0.1, Number(v) || 0.4));
    host.style.setProperty("--bar-op", String(n));
  }

  function reflectEnabled() {
    orbzone.style.display = S.enabled ? "" : "none";
    if (!S.enabled && S.panelOpen) closePanel();
  }
  function reflectAuto() {
    if (S.enabled && S.autoQuestion) startAuto(); else stopAuto();
  }

  /* ---------- orb click = scan now (like Alt+L) ---------- */
  function setState(st) {
    S.state = st;
    orb.className = "orb" + (st === "armed" ? " armed" : st === "thinking" ? " thinking"
      : st === "ready" ? " ready" : st === "error" ? " error" : "");
  }
  orb.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); explainNow(); });

  function explainNow() {
    if (!S.enabled) return;
    const sel = (window.getSelection()?.toString() || "").trim();
    if (sel.length >= 3) {
      const el = selectionElement() || S.lastEl;
      explain(sel.slice(0, 800), contextAround(el), detectMode(sel, el), questionScope(el));
      return;
    }
    const el = S.lastEl || elementUnderCursor();
    const txt = blockText(el);
    if (txt && txt.length >= 3) explain(txt.slice(0, 800), contextAround(el), detectMode(txt, el), questionScope(el));
    else showToast("Selectează un text sau plimbă mouse-ul peste un paragraf, apoi click pe lupă.");
  }

  /* ---------- track page cursor / element (ignore our own UI) ---------- */
  document.addEventListener("mousemove", (e) => {
    if (e.target === host) return;
    S.cursor.x = e.clientX; S.cursor.y = e.clientY; S.lastEl = e.target;
    if (S.scan && S.enabled) scheduleHover(e);
  }, { passive: true });

  /* ---------- triggers: select text -> explain ---------- */
  document.addEventListener("mouseup", (e) => {
    if (!S.enabled) return;
    if (e.target === host) return; // ignore our UI
    const sel = (window.getSelection()?.toString() || "").trim();
    if (sel.length >= 3 && sel !== S.lastSel) {
      explain(sel, contextAround(e.target), detectMode(sel, e.target), questionScope(e.target));
    }
  });

  function scheduleHover(e) {
    clearTimeout(S.hoverTimer);
    if (S.panelOpen) return;
    const el = e.target;
    S.hoverTimer = setTimeout(() => {
      const txt = blockText(el);
      if (txt && txt.length > 24 && txt !== S.lastSel) {
        explain(txt.slice(0, 600), contextAround(el), detectMode(txt, el), questionScope(el));
      }
    }, 850);
  }

  /* ---------- answer checking: pick a quiz option -> verify it ---------- */
  document.addEventListener("change", (e) => {
    if (!S.enabled) return;
    const inp = e.target;
    if (!inp || !inp.matches?.('input[type=radio], input[type=checkbox]')) return;
    if (!inp.checked) return;
    maybeCheckAnswer(inp);
  }, true);

  function maybeCheckAnswer(inp) {
    // a real quiz group has >=2 options. Moodle multi-answer checkboxes each have a
    // DIFFERENT name, so count by the question container too, not just by name.
    const scope = inp.closest(Q_SEL) || inp.parentElement;
    const byName = inp.name
      ? document.querySelectorAll(`input[name="${CSS.escape(inp.name)}"]`).length : 0;
    const byCont = scope ? scope.querySelectorAll('input[type=radio], input[type=checkbox]').length : 0;
    if (Math.max(byName, byCont) < 2) return;
    const question = questionBlock(inp);
    const choice = labelText(inp);
    if (question.length < 12 || choice.length < 1) return;
    checkAnswer(question, choice, contextAround(inp), scope);
  }

  async function checkAnswer(question, choice, context, srcEl) {
    S.lastSel = question;
    S.hlSrc = srcEl || null;
    setState("thinking");
    openLoading("check");
    showHighlight(srcEl);
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({
        type: "explain",
        payload: { selection: question, choice, context, mode: "check", url: location.href },
      });
    } catch (e) { resp = { ok: false, error: String(e) }; }
    if (!resp || !resp.ok || !resp.data || !resp.data.ok) {
      setState("error"); closePanel();
      showToast("Backend-ul nu răspunde — verifică serviciul Lupa.");
      setTimeout(() => setState("idle"), 1400);
      return;
    }
    const d = resp.data;
    if (d.verdict === "correct") {
      setState("ready"); renderPanel(d);
      setTimeout(() => { if (S.state !== "thinking") closePanel(); }, 2600);
    } else {
      setState("armed"); renderPanel(d); // wrong / unsure -> stays open with a fresh hint
    }
  }

  /* ---------- auto-question: explain the visible question as it changes ---------- */
  let autoObserver = null;
  function startAuto() {
    if (autoObserver) return;
    autoObserver = new MutationObserver(() => scheduleAuto());
    autoObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener("scroll", scheduleAuto, { passive: true });
    scheduleAuto();
  }
  function stopAuto() {
    if (autoObserver) { autoObserver.disconnect(); autoObserver = null; }
    window.removeEventListener("scroll", scheduleAuto);
    clearTimeout(S.autoTimer);
  }
  function scheduleAuto() {
    clearTimeout(S.autoTimer);
    S.autoTimer = setTimeout(runAuto, 700);
  }
  function runAuto() {
    if (!S.enabled || !S.autoQuestion || S.state === "thinking") return;
    const q = currentQuestion();
    if (!q || q.text === S.lastAutoQ) return;
    S.lastAutoQ = q.text;
    explain(q.text.slice(0, 800), contextAround(q.el), detectMode(q.text, q.el), q.el);
  }
  function currentQuestion() {
    // First quiz question from the top of the viewport DOWN. A question that has
    // mostly scrolled ABOVE the top is skipped, so when you scroll the next one to
    // the top it becomes the active one. Picks the topmost still-anchored block.
    const inputs = document.querySelectorAll('input[type=radio], input[type=checkbox]');
    const seen = new Set();
    let best = null, bestTop = Infinity;
    for (const inp of inputs) {
      const c = inp.closest(Q_SEL);
      if (!c || seen.has(c)) continue;
      seen.add(c);
      const byName = inp.name
        ? document.querySelectorAll(`input[name="${CSS.escape(inp.name)}"]`).length : 0;
      const byCont = c.querySelectorAll('input[type=radio], input[type=checkbox]').length;
      if (Math.max(byName, byCont) < 2) continue;
      const r = c.getBoundingClientRect();
      const aboveLimit = -Math.min(120, r.height * 0.5); // tolerate a small top crop
      if (r.bottom < 80 || r.top > innerHeight - 80) continue; // below fold / barely visible
      if (r.top < aboveLimit) continue;                        // mostly scrolled past the top
      if (r.top < bestTop) { bestTop = r.top; best = c; }
    }
    if (!best) return null;
    const text = (best.innerText || "").trim().replace(/\s+/g, " ").slice(0, 800);
    if (text.length < 12) return null;
    return { el: best, text };
  }

  /* ---------- commands / closing ---------- */
  chrome.runtime?.onMessage.addListener((msg) => {
    if (msg?.type !== "command") return;
    if (msg.command === "toggle-lens") {
      S.enabled = !S.enabled;
      chrome.storage?.sync.set({ enabled: S.enabled });
      reflectEnabled();
      showToast(S.enabled
        ? `👓 Lupa <b>pornită</b> · selectează text, click pe lupă sau <kbd>Alt</kbd>+<kbd>L</kbd>`
        : `Lupa <b>oprită</b>. <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> ca s-o pornești.`);
    } else if (msg.command === "explain-now") {
      explainNow();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && S.panelOpen) { closePanel(); return; }
    if ((e.key === "h" || e.key === "H") && S.panelOpen
        && !e.metaKey && !e.ctrlKey && !e.altKey && !isEditable(e.target)) {
      e.preventDefault(); toggleBar();
    }
  });
  function isEditable(el) {
    if (!el) return false;
    const t = (el.tagName || "").toLowerCase();
    return t === "input" || t === "textarea" || t === "select" || el.isContentEditable;
  }
  // click anywhere outside the bar closes it — except on a quiz option (that path
  // runs the answer check, which manages the bar itself).
  document.addEventListener("mousedown", (e) => {
    if (!S.panelOpen) return;
    if (e.target === host) return;
    if (answerControl(e.target)) return;
    closePanel();
  });

  /* ---------- helpers ---------- */
  function answerControl(el) {
    if (!el || !el.closest) return false;
    return !!el.closest('input[type=radio], input[type=checkbox], label, .answer, [role=radio], [role=option]');
  }
  // closest question container — Moodle uses .que / .formulation
  const Q_SEL = "fieldset, .que, .formulation, .question, .quiz, .q, li, form, section, article";
  function elementUnderCursor() {
    return document.elementFromPoint(S.cursor.x, S.cursor.y) || document.body;
  }
  function selectionElement() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    let n = sel.getRangeAt(0).commonAncestorContainer;
    return n.nodeType === 1 ? n : n.parentElement;
  }
  // The question container to frame/scope dimming to — the nearest quiz block.
  function questionScope(el) {
    if (!el || !el.closest) return el || null;
    return el.closest(Q_SEL) || el;
  }

  /* ---------- highlight frame + excluded-option overlay ---------- */
  // We never style the page's own elements (fragile across sites). Instead we draw
  // our own fixed overlays positioned over the matched option boxes in the viewport.
  function normTxt(s) { return (s || "").toLowerCase().replace(/\s+/g, " ").trim(); }

  function showHighlight(el) {
    if (!el || !el.getBoundingClientRect) { hideHighlight(); return; }
    S.hlEl = el;
    positionHighlight();
    hl.classList.add("show");
  }
  function positionHighlight() {
    if (!S.hlEl) return;
    const r = S.hlEl.getBoundingClientRect();
    hl.style.left = (r.left - 4) + "px"; hl.style.top = (r.top - 4) + "px";
    hl.style.width = (r.width + 8) + "px"; hl.style.height = (r.height + 8) + "px";
  }
  function hideHighlight() { S.hlEl = null; hl.classList.remove("show"); }

  // find the tightest on-page element whose text matches an option string;
  // search the question first, then the whole page as a fallback
  function findOption(optText, used) {
    const target = normTxt(optText);
    if (target.length < 4) return null;
    const scopes = [];
    if (S.hlSrc && S.hlSrc.querySelectorAll) scopes.push(S.hlSrc);
    scopes.push(document.body);
    const SEL = "label, li, [role=radio], [role=option], [role=button], button, a, p, td, div, span";
    const words = target.split(" ").filter((w) => w.length >= 4);
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    for (const scope of scopes) {
      // pass 1: smallest element that FULLY contains the option text (exact-ish)
      let best = null, bestLen = Infinity;
      for (const el of scope.querySelectorAll(SEL)) {
        if (used && used.has(el)) continue;
        const t = normTxt(el.innerText || el.textContent);
        if (!t || !t.includes(target)) continue;     // must contain the whole option
        if (t.length < bestLen && visible(el)) { best = el; bestLen = t.length; }
      }
      if (best) return best;
      // pass 2: token-overlap fallback (handles light paraphrase by the model)
      if (words.length) {
        let bo = null, boScore = 0.6, boLen = Infinity;
        for (const el of scope.querySelectorAll(SEL)) {
          if (used && used.has(el)) continue;
          const t = normTxt(el.innerText || el.textContent);
          if (!t || t.length > target.length * 2.2) continue;
          const hit = words.filter((w) => t.includes(w)).length / words.length;
          if (hit >= boScore && visible(el) && (hit > boScore || t.length < boLen)) {
            bo = el; boScore = hit; boLen = t.length;
          }
        }
        if (bo) return bo;
      }
    }
    return null;
  }
  // draw left-edge bars on the options: red = excluded, green = leaned-to, grey = other
  function applyOptionBars(d, isMulti) {
    clearDim();
    const used = new Set();
    const draw = (optText, cls) => {
      const target = findOption(optText, used);
      if (!target) return;
      used.add(target);
      const ov = document.createElement("div");
      ov.className = "dimbar " + cls;
      root.appendChild(ov);
      S.dimEls.push({ ov, target });
    };
    for (const e of (d.eliminate || [])) draw(e.opt, "red");
    const f = d.finalists || [];
    if (!isMulti && d.lean && d.lean.toward && f.length === 2) {
      const t = normTxt(d.lean.toward);
      const favIdx = (normTxt(f[1]).includes(t) || t.includes(normTxt(f[1]))) ? 1 : 0;
      draw(f[favIdx], "green");
      draw(f[1 - favIdx], "grey");
    }
    positionDims();
  }
  function positionDims() {
    for (const d of S.dimEls) {
      const r = d.target.getBoundingClientRect();
      d.ov.style.left = (r.left + 1) + "px";
      d.ov.style.top = (r.top + 3) + "px";
      d.ov.style.height = Math.max(0, r.height - 6) + "px";
    }
  }
  function clearDim() {
    for (const d of S.dimEls) { try { d.ov.remove(); } catch (_) {} }
    S.dimEls = [];
  }
  // one set of listeners keeps the frame + overlays glued while scrolling/resizing
  function repositionAll() { positionHighlight(); positionDims(); }
  window.addEventListener("scroll", repositionAll, { passive: true });
  window.addEventListener("resize", repositionAll);
  function blockText(el) {
    if (!el) return "";
    let n = el;
    for (let i = 0; i < 4 && n && n.parentElement; i++) {
      const t = (n.innerText || n.textContent || "").trim();
      if (t.length > 40) return t.replace(/\s+/g, " ");
      n = n.parentElement;
    }
    return (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
  }
  function contextAround(el) {
    const base = el || elementUnderCursor();
    const c = base.closest?.("article, section, main, .que, .formulation, .question, .quiz, li, p, form, body") || document.body;
    return (c.innerText || "").trim().replace(/\s+/g, " ").slice(0, 1000);
  }
  function labelText(inp) {
    let t = "";
    if (inp.id) { const l = document.querySelector(`label[for="${CSS.escape(inp.id)}"]`); if (l) t = l.innerText; }
    if (!t) { const l = inp.closest?.("label"); if (l) t = l.innerText; }
    if (!t && inp.parentElement) t = inp.parentElement.innerText;
    return (t || inp.value || "").trim().replace(/\s+/g, " ").slice(0, 200);
  }
  function questionBlock(inp) {
    const c = inp.closest?.(Q_SEL) || inp.parentElement;
    return (c?.innerText || "").trim().replace(/\s+/g, " ").slice(0, 800);
  }
  function detectMode(text, el) {
    if (S.mode !== "auto") return S.mode;
    const t = (text || "").toLowerCase();
    const looksQuiz = /\?/.test(t) &&
      (/\b[a-d]\)|\bvarianta|care (este|dintre)|corect|adevărat|fals\b/.test(t) ||
        (el && el.closest && el.closest("label, .question, .quiz, fieldset")) ||
        (el && nearbyInputs(el)));
    if (looksQuiz) return "quiz";
    const onField = el && el.closest && el.closest("textarea, input[type=text], [contenteditable=true]");
    if (onField) return "write";
    return "explain";
  }
  function nearbyInputs(el) {
    const scope = el.closest?.("form, fieldset, .question, .quiz, li, div") || document;
    return scope.querySelector?.('input[type=radio], input[type=checkbox]');
  }

  /* ---------- the call ---------- */
  async function explain(selection, context, mode, srcEl) {
    S.lastSel = selection;
    S.hlSrc = srcEl || null;
    setState("thinking");
    openLoading(mode);
    showHighlight(srcEl);
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({
        type: "explain",
        payload: { selection, context, mode, url: location.href },
      });
    } catch (e) {
      resp = { ok: false, error: String(e) };
    }
    if (!resp || !resp.ok) {
      setState("error");
      closePanel();
      showToast(`Backend-ul nu răspunde. Pornește-l: <b>~/PROJECTS/study-lens/backend/run.sh</b>`);
      setTimeout(() => setState("idle"), 1400);
      return;
    }
    const d = resp.data || {};
    if (!d.ok) { setState("error"); closePanel(); showToast(d.error || "Eroare."); setTimeout(()=>setState("idle"),1200); return; }
    setState("ready");
    renderPanel(d);
    setTimeout(() => { if (S.state === "ready") setState("idle"); }, 2500);
  }

  /* ---------- info bar ---------- */
  function openLoading(mode) {
    S.panelOpen = true;
    S.barExpanded = false;             // every new question starts collapsed (peek only)
    panel.classList.remove("expanded");
    panel.innerHTML = `<div class="p-loading"><div class="shimmer"></div>
      ${mode === "check" ? "Lupa verifică alegerea ta…" : "Lupa se uită în materie…"}</div>`;
    requestAnimationFrame(() => panel.classList.add("show"));
  }
  function toggleBar() {
    S.barExpanded = !S.barExpanded;
    panel.classList.toggle("expanded", S.barExpanded);
  }
  function esc(s){ return (s||"").replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  // DJ crossfader (single-answer) or per-option level faders (multi-answer)
  function faderHTML(d, isMulti) {
    if (isMulti) {
      const picks = (d.picks || []).filter((p) => p && p.opt);
      if (!picks.length) return "";
      const rows = picks.map((p) => {
        const pct = Math.round(Math.max(0, Math.min(1, Number(p.score) || 0)) * 100);
        const cls = pct >= 60 ? " hot" : pct <= 30 ? " cold" : "";
        return `<div class="m-slider">
          <div class="m-track"><div class="m-fill${cls}" style="width:${pct}%"></div></div>
          <span class="m-pct">${pct}%</span>
          <span class="m-lbl" title="${esc(p.opt)}">${esc(p.opt)}</span>
        </div>`;
      }).join("");
      return `<div class="p-faders">${rows}</div>`;
    }
    const f = d.finalists || [];
    const lean = d.lean;
    if (f.length !== 2 || !lean || !lean.toward) return "";
    const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
    const t = norm(lean.toward);
    const favRight = norm(f[1]).includes(t) || t.includes(norm(f[1]));
    const s = Math.max(0.5, Math.min(0.9, Number(lean.strength) || 0.5));
    const pos = Math.round((favRight ? s : 1 - s) * 100); // knob: 0=stânga(A), 100=dreapta(B)
    const pct = Math.round(s * 100);
    return `
      <div class="p-fader">
        <div class="f-row">
          <span class="f-deck ${favRight ? "" : "fav"}" title="${esc(f[0])}">${esc(f[0])}</span>
          <div class="f-track"><div class="f-mid"></div><div class="f-knob" style="left:${pos}%"></div></div>
          <span class="f-deck ${favRight ? "fav" : ""}" title="${esc(f[1])}">${esc(f[1])}</span>
        </div>
        <div class="b-cap">${pct}% spre „${esc(lean.toward)}"</div>
      </div>`;
  }
  function renderPanel(d) {
    S.panelOpen = true;
    const modeLabel = d.mode === "quiz" ? "ghid" : d.mode === "write" ? "schelă"
      : d.mode === "check" ? "verificare" : "explică";
    const elimItems = (d.eliminate || []).slice(0, 2);
    const verdict = d.verdict === "wrong"
      ? `<div class="p-verdict wrong">🤔 Mai gândește-te</div>`
      : d.verdict === "correct"
        ? `<div class="p-verdict ok">✅ Corect!</div>` : "";
    const isMulti = d.multi || (S.hlSrc && S.hlSrc.querySelector &&
      !!S.hlSrc.querySelector('input[type=checkbox]'));
    const multi = isMulti
      ? `<div class="p-multi">◳ Răspuns multiplu — bifează TOATE corecte</div>` : "";
    const hint = d.hint ? `<div class="p-hint">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c97f17" stroke-width="2" stroke-linecap="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1h6c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/></svg>
        <span>${esc(d.hint)}</span></div>` : "";
    const elim = elimItems
      .map(e => `<span class="p-elim" title="${esc(e.why || "")}"><b>✕ nu e:</b> ${esc(e.opt)}</span>`).join("");
    const elims = elim ? `<div class="p-elims">${elim}</div>` : "";
    const bal = faderHTML(d, isMulti);
    const peek = bal
      ? bal
      : `<div class="p-peektitle"><span class="p-dot"></span>${esc(d.concept || "Concept")}</div>`;
    panel.innerHTML = `
      <div class="p-peek">
        ${peek}
        <span class="p-toggle" id="elupa-h" title="Arată / ascunde detaliile (tasta H)">H</span>
      </div>
      <div class="p-full">
        <div class="p-head">
          <span class="p-dot"></span>
          <span class="p-title">${esc(d.concept || "Concept")}</span>
          <span class="p-mode">${modeLabel}</span>
        </div>
        ${multi}
        ${verdict}
        <div class="p-body">${esc(d.explain || "")}</div>
        ${elims}
        ${hint}
      </div>
      <span class="p-x" id="elupa-x">✕</span>`;
    root.getElementById("elupa-x").addEventListener("click", closePanel);
    root.getElementById("elupa-h").addEventListener("click", toggleBar);
    panel.classList.toggle("expanded", S.barExpanded);
    applyOptionBars(d, isMulti);
    positionHighlight();
    requestAnimationFrame(() => panel.classList.add("show"));
  }
  function closePanel() {
    S.panelOpen = false;
    panel.classList.remove("show");
    hideHighlight();
    clearDim();
    if (S.state !== "thinking") setState("idle");
  }

  /* ---------- toast ---------- */
  let toastTimer;
  function showToast(html) {
    toast.innerHTML = html; toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 4200);
  }

  // first-run hello
  chrome.storage?.sync.get({ helloShown: false }, (r) => {
    if (!r.helloShown) {
      setTimeout(() => showToast(`👓 <b>Lupa</b> e activă. Selectează un text, click pe lupa din colț sau <kbd>Alt</kbd>+<kbd>L</kbd>.`), 900);
      chrome.storage?.sync.set({ helloShown: true });
    }
  });
})();
