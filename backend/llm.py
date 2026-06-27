"""
Thin Claude client.

Priority:
1. ANTHROPIC_API_KEY in env  -> fast SDK call (streaming-capable).
2. otherwise                 -> `claude -p` OAuth ($0 on the Max subscription).

We deliberately bypass the shared claude_cached wrapper here: it forces
ENABLE_TOOL_SEARCH=1 (heavy CLI cold-start) which we don't want for a snappy
lens. Best-effort cost logging into app.api_calls is still attempted on the
OAuth path so usage stays visible.
"""
from __future__ import annotations
import json
import os
import re
import subprocess
import time

MODEL = os.environ.get("LENS_MODEL", "claude-sonnet-4-6")
_OAUTH_MODEL = {
    "claude-sonnet-4-6": "sonnet",
    "claude-opus-4-8": "opus",
    "claude-opus-4-7": "opus",
    "claude-haiku-4-5": "haiku",
}

# ── runtime auth config ──────────────────────────────────────────────────────
# Lives OUTSIDE the project tree so it survives auto-update (update-lupa.sh
# overwrites backend files) and stays local per machine — Cipri's API key never
# leaves his computer / never enters the repo. auth_mode: auto | oauth | api.
CONFIG_DIR = os.path.expanduser("~/.lupa")
CONFIG_PATH = os.path.join(CONFIG_DIR, "config.json")
_DEFAULT_CFG = {"auth_mode": "auto", "api_key": ""}


def runtime_config() -> dict:
    cfg = dict(_DEFAULT_CFG)
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            for k in cfg:
                if k in data:
                    cfg[k] = data[k]
    except Exception:
        pass
    if cfg.get("auth_mode") not in ("auto", "oauth", "api"):
        cfg["auth_mode"] = "auto"
    cfg["api_key"] = (cfg.get("api_key") or "").strip()
    return cfg


def save_runtime_config(patch: dict) -> dict:
    cfg = runtime_config()
    if patch.get("auth_mode") in ("auto", "oauth", "api"):
        cfg["auth_mode"] = patch["auth_mode"]
    if patch.get("api_key") is not None:
        cfg["api_key"] = str(patch["api_key"]).strip()
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f)
    try:
        os.chmod(CONFIG_PATH, 0o600)   # the key is sensitive
    except Exception:
        pass
    return cfg


def mask_key(key: str) -> str:
    key = (key or "").strip()
    if not key:
        return ""
    return ("…" + key[-4:]) if len(key) > 4 else "••••"


def resolve_auth() -> tuple[bool, str | None, str]:
    """(use_api, api_key, auth_label) from runtime config, falling back to env."""
    cfg = runtime_config()
    mode = cfg["auth_mode"]
    cfg_key = cfg["api_key"]
    env_key = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")
    if mode == "oauth":
        return False, None, "oauth"
    if mode == "api":
        key = cfg_key or env_key
        return (bool(key), key, "api" if key else "oauth")
    # auto -> legacy behaviour: API only if an env key is present
    return (bool(env_key), env_key, "api" if env_key else "oauth")


def _balanced_objects(text: str):
    """Yield every top-level {...} substring via brace-depth scanning.
    Robust to ```json fences, preambles, and nested objects."""
    depth = 0
    start = -1
    in_str = False
    esc = False
    for i, ch in enumerate(text):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            if depth > 0:
                depth -= 1
                if depth == 0 and start >= 0:
                    yield text[start:i + 1]


def _extract_json(text: str) -> dict | None:
    if not text:
        return None
    text = text.strip()
    # 1) clean fast path: whole thing (minus fences) is the object
    stripped = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE).strip()
    for cand in (stripped, text):
        try:
            d = json.loads(cand)
            if isinstance(d, dict):
                return d
        except Exception:
            pass
    # 2) scan every balanced {...}; prefer one that has our schema keys.
    fallback = None
    for chunk in _balanced_objects(text):
        try:
            d = json.loads(chunk)
        except Exception:
            continue
        if not isinstance(d, dict):
            continue
        if "explain" in d or "concept" in d:
            return d
        fallback = fallback or d
    if fallback:
        return fallback
    # 3) last resort: schema-anchored field extraction. Robust to invalid JSON
    #    caused by stray ASCII quotes inside Romanian text (mixed „ " / ") — we
    #    split on the next field's key, not on quote balance.
    return _loose_fields(text)


def _loose_fields(text: str) -> dict | None:
    def grab_str(name, nexts):
        # value between  "name": "  and the next field key (or closing brace)
        stop = "|".join(re.escape(f'"{n}"') for n in nexts) or r"\}"
        m = re.search(rf'"{name}"\s*:\s*"(.*?)"\s*,?\s*(?:{stop}|\}})',
                      text, re.DOTALL)
        return m.group(1).strip().rstrip('"').strip() if m else ""

    concept = grab_str("concept", ["explain", "keys", "hint", "verdict", "chapter"])
    explain = grab_str("explain", ["keys", "hint", "verdict", "chapter"])
    hint = grab_str("hint", ["verdict", "chapter"])
    verdict = ""
    mv = re.search(r'"verdict"\s*:\s*"([^"]*)"', text)
    if mv:
        verdict = mv.group(1).strip()
    mm = re.search(r'"multi"\s*:\s*(?:"?(true|false|da|yes|1|0)"?)', text, re.IGNORECASE)
    multi = bool(mm) and mm.group(1).lower() in ("true", "da", "yes", "1")
    chapter = ""
    mc = re.search(r'"chapter"\s*:\s*"([^"]*)"', text)
    if mc:
        chapter = mc.group(1).strip()
    keys = []
    mk = re.search(r'"keys"\s*:\s*\[(.*?)\]', text, re.DOTALL)
    if mk:
        keys = [k.strip().strip('"').strip() for k in re.findall(r'"([^"]*)"', mk.group(1))]
    eliminate = []
    me = re.search(r'"eliminate"\s*:\s*\[(.*?)\]', text, re.DOTALL)
    if me:
        for obj in re.findall(r'\{(.*?)\}', me.group(1), re.DOTALL):
            mo = re.search(r'"opt"\s*:\s*"([^"]*)"', obj)
            mw = re.search(r'"why"\s*:\s*"([^"]*)"', obj)
            if mo and mo.group(1).strip():
                eliminate.append({"opt": mo.group(1).strip(),
                                  "why": mw.group(1).strip() if mw else ""})
    finalists = []
    mf = re.search(r'"finalists"\s*:\s*\[(.*?)\]', text, re.DOTALL)
    if mf:
        finalists = [s.strip() for s in re.findall(r'"([^"]*)"', mf.group(1)) if s.strip()][:2]
    lean = None
    ml = re.search(r'"lean"\s*:\s*\{(.*?)\}', text, re.DOTALL)
    if ml:
        body = ml.group(1)
        mt = re.search(r'"toward"\s*:\s*"([^"]*)"', body)
        ms = re.search(r'"strength"\s*:\s*([0-9.]+)', body)
        if mt and mt.group(1).strip():
            lean = {"toward": mt.group(1).strip(),
                    "strength": float(ms.group(1)) if ms else 0.5}
    picks = []
    mp = re.search(r'"picks"\s*:\s*\[(.*?)\]', text, re.DOTALL)
    if mp:
        for obj in re.findall(r'\{(.*?)\}', mp.group(1), re.DOTALL):
            mo = re.search(r'"opt"\s*:\s*"([^"]*)"', obj)
            msc = re.search(r'"score"\s*:\s*([0-9.]+)', obj)
            if mo and mo.group(1).strip():
                picks.append({"opt": mo.group(1).strip(),
                              "score": float(msc.group(1)) if msc else 0.5})
    if not (concept or explain):
        return None
    return {"concept": concept, "explain": explain, "keys": keys,
            "hint": hint, "verdict": verdict, "multi": multi,
            "eliminate": eliminate, "finalists": finalists, "lean": lean,
            "picks": picks, "chapter": chapter}


def _via_api(system: str, prompt: str, model: str, max_tokens: int,
             api_key: str | None = None) -> str:
    import anthropic  # lazy: only when a key is present
    client = anthropic.Anthropic(api_key=api_key) if api_key else anthropic.Anthropic()
    resp = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    return "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")


def _via_oauth(system: str, prompt: str, model: str) -> str:
    full = f"{system}\n\n---\n\n{prompt}"
    env = dict(os.environ)
    env.pop("ANTHROPIC_API_KEY", None)
    # DELIBERATE EXCEPTION to the CLAUDE.md rule "claude -p => ENABLE_TOOL_SEARCH=1".
    # That rule targets agentic RUNNERS that need tools. This lens is a single-shot,
    # tool-free JSON generation: with =1, `claude -p` turns conversational (adds
    # preamble/postamble, sometimes truncating the JSON) which corrupts parsing.
    # With =0 it returns clean JSON directly. Verified empirically 2026-06-24.
    env["ENABLE_TOOL_SEARCH"] = "0"
    cli_model = _OAUTH_MODEL.get(model, "sonnet")
    # skip loading the user's MCP servers (n8n/supabase/etc.) — they add cold-start
    # latency on every call and the lens never needs tools.
    proc = subprocess.run(
        ["claude", "-p", full, "--model", cli_model,
         "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}'],
        capture_output=True, text=True, env=env, timeout=90,
    )
    if proc.returncode != 0 and not proc.stdout:
        raise RuntimeError(f"claude -p exit {proc.returncode}: {(proc.stderr or '')[:200]}")
    return (proc.stdout or "").strip()


def _via_oauth_web(system: str, prompt: str, model: str) -> str:
    """OAuth call WITH web search allowed — for the rare 'caută online' escalation.
    Free on the Max/Pro subscription; slower (agentic). Tools enabled, MCP still off."""
    full = f"{system}\n\n---\n\n{prompt}\n\n(Poți căuta pe web dacă e nevoie. Întoarce DOAR JSON-ul cerut la final.)"
    env = dict(os.environ)
    env.pop("ANTHROPIC_API_KEY", None)
    env["ENABLE_TOOL_SEARCH"] = "0"
    cli_model = _OAUTH_MODEL.get(model, "sonnet")
    proc = subprocess.run(
        ["claude", "-p", full, "--model", cli_model,
         "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
         "--allowedTools", "WebSearch"],
        capture_output=True, text=True, env=env, timeout=120,
    )
    if proc.returncode != 0 and not proc.stdout:
        raise RuntimeError(f"claude -p exit {proc.returncode}: {(proc.stderr or '')[:200]}")
    return (proc.stdout or "").strip()


def ask(system: str, prompt: str, model: str | None = None, max_tokens: int = 1000) -> dict:
    """Return {'data': <parsed json or None>, 'raw': str, 'ms': int, 'auth': str}."""
    model = model or MODEL
    t0 = time.time()
    use_api, api_key, auth = resolve_auth()
    try:
        raw = (_via_api(system, prompt, model, max_tokens, api_key)
               if use_api else _via_oauth(system, prompt, model))
    except Exception as e:
        return {"data": None, "raw": "", "ms": int((time.time() - t0) * 1000),
                "auth": auth, "error": str(e)}
    ms = int((time.time() - t0) * 1000)
    data = _extract_json(raw)
    _log_best_effort(model, ms, auth)
    return {"data": data, "raw": raw, "ms": ms, "auth": auth}


def ask_web(system: str, prompt: str, model: str | None = None) -> dict:
    """Web-search-backed answer (OAuth only; the rare 'caută online' path)."""
    model = model or MODEL
    t0 = time.time()
    try:
        raw = _via_oauth_web(system, prompt, model)
    except Exception as e:
        return {"data": None, "raw": "", "ms": int((time.time() - t0) * 1000),
                "auth": "oauth", "error": str(e)}
    ms = int((time.time() - t0) * 1000)
    _log_best_effort(model, ms, "oauth")
    return {"data": _extract_json(raw), "raw": raw, "ms": ms, "auth": "oauth"}


def _log_best_effort(model: str, ms: int, auth: str) -> None:
    try:
        import sys
        sys.path.insert(0, os.path.expanduser("~/.claude/memory/scripts"))
        from lib.db import get_pg
        pg = get_pg()
        cur = pg.cursor()
        cur.execute(
            """INSERT INTO app.api_calls
               (model, purpose, project, tokens_input, tokens_cached_read,
                tokens_cached_write, tokens_output, cost_usd, duration_ms, metadata)
               VALUES (%s,%s,%s,0,0,0,0,0,%s,%s)""",
            (model, "study_lens_explain", "study-lens", ms,
             json.dumps({"auth": auth})),
        )
        pg.commit()
        cur.close()
        pg.close()
    except Exception:
        pass  # logging is best-effort; never break the lens
