"""
Study-Lens backend — local FastAPI on 127.0.0.1:8077.

POST /explain  {selection, context, mode, url}  -> tutor explanation (JSON)
GET  /health                                     -> {ok, chunks, model}

The lens calls this on demand (select / hover-hold / hotkey) — never on every
mouse move. Responses are cached on disk by hash(selection+mode) so repeats are
instant and free.
"""
from __future__ import annotations
import hashlib
import json
import os
import time

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import retrieval
import llm
from prompts import TUTOR_SYSTEM, build_user_prompt

CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache")
os.makedirs(CACHE_DIR, exist_ok=True)

app = FastAPI(title="Study-Lens", version="0.1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # local-only server; lens runs on arbitrary pages
    allow_methods=["*"],
    allow_headers=["*"],
)


class ExplainReq(BaseModel):
    selection: str = ""
    context: str = ""
    mode: str = "explain"         # explain | quiz | write | check
    choice: str = ""              # the answer the student picked (mode=check)
    url: str = ""
    model: str | None = None
    nocache: bool = False


def _norm_lean(raw) -> dict | None:
    if not isinstance(raw, dict):
        return None
    toward = str(raw.get("toward", "")).strip()[:120]
    if not toward:
        return None
    try:
        strength = float(raw.get("strength", 0.5))
    except (TypeError, ValueError):
        strength = 0.5
    strength = max(0.5, min(0.9, strength))   # keep it a lean, never absolute
    return {"toward": toward, "strength": round(strength, 2)}


def _norm_finalists(raw) -> list:
    if not isinstance(raw, list):
        return []
    return [str(x).strip()[:120] for x in raw if str(x).strip()][:2]


def _norm_picks(raw) -> list:
    """[{opt, score 0..1}] for multi-answer questions, sorted high->low."""
    if not isinstance(raw, list):
        return []
    out = []
    for it in raw:
        if not isinstance(it, dict):
            continue
        opt = str(it.get("opt", "")).strip()[:120]
        if not opt:
            continue
        try:
            score = float(it.get("score", 0.5))
        except (TypeError, ValueError):
            score = 0.5
        out.append({"opt": opt, "score": round(max(0.0, min(1.0, score)), 2)})
    out.sort(key=lambda x: x["score"], reverse=True)
    return out[:6]


def _norm_eliminate(raw) -> list:
    """Keep at most 2 well-formed {opt, why} entries; tolerate strings too."""
    out = []
    if not isinstance(raw, list):
        return out
    for it in raw:
        if isinstance(it, dict):
            opt = str(it.get("opt", "")).strip()
            why = str(it.get("why", "")).strip()
        elif isinstance(it, str):
            opt, why = it.strip(), ""
        else:
            continue
        if opt:
            out.append({"opt": opt[:160], "why": why[:160]})
        if len(out) >= 2:
            break
    return out


def _cache_key(req: ExplainReq) -> str:
    h = hashlib.sha256(f"{req.mode}|{(req.selection or '').strip()}".encode("utf-8")).hexdigest()
    return os.path.join(CACHE_DIR, f"{h}.json")


@app.get("/health")
def health():
    idx = retrieval.get_index()
    return {"ok": True, "chunks": len(idx.chunks), "model": llm.MODEL}


@app.post("/explain")
def explain(req: ExplainReq):
    sel = (req.selection or "").strip()
    if len(sel) < 3:
        return {"ok": False, "error": "selectie prea scurta"}

    # answer-checking depends on the picked choice -> always fresh, never cached
    use_cache = not req.nocache and req.mode != "check"
    cache_path = _cache_key(req)
    if use_cache and os.path.exists(cache_path):
        try:
            cached = json.load(open(cache_path, encoding="utf-8"))
            cached["cached"] = True
            return cached
        except Exception:
            pass

    # retrieve course material to ground the explanation
    hits = retrieval.search(f"{sel} {req.context}", k=3)
    course_ctx = "\n\n".join(
        f"[{h['chapter']} · {h['chapter_title']} — {h['heading']}]\n{h['text'][:600]}"
        for h in hits
    )

    user_prompt = build_user_prompt(sel, req.context, req.mode, course_ctx, req.choice)
    res = llm.ask(TUTOR_SYSTEM, user_prompt, model=req.model)

    data = res.get("data")
    if not data:
        # graceful fallback: still surface raw text + best retrieval hit
        return {
            "ok": True,
            "concept": sel[:60],
            "explain": (res.get("raw") or "Nu am putut genera explicația acum.")[:600],
            "keys": [],
            "hint": "",
            "chapter": hits[0]["chapter"] if hits else "",
            "sources": [{"chapter": h["chapter"], "title": h["chapter_title"],
                         "heading": h["heading"]} for h in hits],
            "ms": res.get("ms"),
            "auth": res.get("auth"),
            "degraded": True,
        }

    out = {
        "ok": True,
        "concept": data.get("concept", sel[:60]),
        "explain": data.get("explain", ""),
        "keys": data.get("keys", []) or [],
        "hint": data.get("hint", ""),
        "verdict": (data.get("verdict", "") or "").lower(),
        "multi": str(data.get("multi", "")).strip().lower() in ("true", "1", "da", "yes"),
        "eliminate": _norm_eliminate(data.get("eliminate")),
        "finalists": _norm_finalists(data.get("finalists")),
        "lean": _norm_lean(data.get("lean")),
        "picks": _norm_picks(data.get("picks")),
        "chapter": data.get("chapter", "") or (hits[0]["chapter"] if hits else ""),
        "sources": [{"chapter": h["chapter"], "title": h["chapter_title"],
                     "heading": h["heading"], "score": h.get("score")} for h in hits],
        "ms": res.get("ms"),
        "auth": res.get("auth"),
        "mode": req.mode,
        "ts": int(time.time()),
    }
    # single-answer -> crossfader (finalists + lean); multi-answer -> per-option picks
    if out["multi"]:
        out["finalists"] = []
        out["lean"] = None
    else:
        out["picks"] = []
        if not out["lean"] or len(out["finalists"]) != 2:
            out["finalists"] = []
            out["lean"] = None
    if use_cache:
        try:
            json.dump(out, open(cache_path, "w", encoding="utf-8"), ensure_ascii=False)
        except Exception:
            pass
    return out


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("LENS_PORT", "8077")))
