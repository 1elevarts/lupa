"""
Lightweight TF-IDF retrieval over the invatacu-neuro course content.

No external deps (no sklearn / numpy needed) so the backend stays self-contained
and always boots. Loads the 11 neuro chapters, splits each into sections by <h3>
headings + the quiz questions, and scores a query against every chunk with
cosine similarity over TF-IDF vectors.

Upgrade path: swap `_embed`-free scoring for nomic-embed-text (Ollama :11434)
later — the chunk store and `search()` signature stay the same.
"""
from __future__ import annotations
import glob
import json
import math
import os
import re
from collections import Counter
from functools import lru_cache

def _resolve_neuro_dir() -> str:
    # Portable: prefer the content bundled inside the project (works on any Mac),
    # fall back to the Mac Mini source, then an env override.
    env = os.environ.get("LENS_NEURO_DIR")
    if env and os.path.isdir(env):
        return env
    bundled = os.path.join(os.path.dirname(__file__), "neuro_content")
    if os.path.isdir(bundled):
        return bundled
    return os.path.expanduser("~/PROJECTS/invatacu-neuro/content")


NEURO_DIR = _resolve_neuro_dir()

# Romanian + English stopwords — kept small, just the high-frequency noise.
_STOP = set("""
a ai al ale am ar au ca care ce cel cea ci cu da de din doar el ea este era esti
eu fi fie i ia iar in intr intre la le li lor lui mai mea mei mele mi mine mod ne
ni noi nu o pe pentru prin sa sau se si sunt te ti toate tot tu un una unei unele
unor va vi voi vor ar fi fost the and for are was were that this with from into of
to in on at by an as is be it or if you your they them their we our not no but
""".split())

_WORD = re.compile(r"[a-zA-ZăâîșțĂÂÎȘȚ]{3,}")


def _strip_html(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s or "")
    s = re.sub(r"&[a-z]+;", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _tokens(text: str) -> list[str]:
    return [w.lower() for w in _WORD.findall(text or "") if w.lower() not in _STOP]


class NeuroIndex:
    def __init__(self, chunks: list[dict]):
        self.chunks = chunks
        self._tf: list[Counter] = []
        df: Counter = Counter()
        for ch in chunks:
            toks = _tokens(ch["text"])
            tf = Counter(toks)
            self._tf.append(tf)
            for term in tf:
                df[term] += 1
        n = max(1, len(chunks))
        self._idf = {t: math.log((n + 1) / (c + 1)) + 1.0 for t, c in df.items()}
        # precompute chunk vector norms
        self._norm: list[float] = []
        for tf in self._tf:
            ss = sum((cnt * self._idf.get(t, 0.0)) ** 2 for t, cnt in tf.items())
            self._norm.append(math.sqrt(ss) or 1.0)

    def search(self, query: str, k: int = 3) -> list[dict]:
        q = Counter(_tokens(query))
        if not q:
            return []
        qvec = {t: cnt * self._idf.get(t, 0.0) for t, cnt in q.items()}
        qnorm = math.sqrt(sum(v * v for v in qvec.values())) or 1.0
        scored = []
        for i, tf in enumerate(self._tf):
            dot = sum(qvec.get(t, 0.0) * cnt * self._idf.get(t, 0.0)
                      for t, cnt in tf.items())
            score = dot / (qnorm * self._norm[i])
            if score > 0:
                scored.append((score, i))
        scored.sort(reverse=True)
        out = []
        for score, i in scored[:k]:
            c = dict(self.chunks[i])
            c["score"] = round(score, 4)
            out.append(c)
        return out


def _load_chunks() -> list[dict]:
    chunks: list[dict] = []
    if not os.path.isdir(NEURO_DIR):
        return chunks
    # Load EVERY n*.json so new subjects/chapters added later are picked up
    # automatically on the next backend restart — no code change needed.
    paths = sorted(glob.glob(os.path.join(NEURO_DIR, "n*.json")))
    for path in paths:
        stem = os.path.splitext(os.path.basename(path))[0]
        try:
            d = json.load(open(path, encoding="utf-8"))
        except Exception:
            continue
        cid = d.get("id", stem)
        ctitle = d.get("title", cid)
        html = d.get("summary_html", "")
        # split summary into sections by <h3>
        parts = re.split(r"(?i)<h3[^>]*>", html)
        for p in parts:
            text = _strip_html(p)
            if len(text) < 40:
                continue
            heading = text.split(".")[0][:80]
            chunks.append({
                "chapter": cid,
                "chapter_title": ctitle,
                "heading": heading,
                "text": text,
                "kind": "summary",
            })
        # index quiz questions too (concept-rich)
        for q in d.get("questions", []):
            qtext = q.get("q", "")
            opts = " ".join(q.get("options", []))
            expl = " ".join(q.get("explain", [])) if isinstance(q.get("explain"), list) else str(q.get("explain", ""))
            chunks.append({
                "chapter": cid,
                "chapter_title": ctitle,
                "heading": qtext[:80],
                "text": _strip_html(f"{qtext} {opts} {expl}"),
                "kind": "question",
            })
    return chunks


@lru_cache(maxsize=1)
def get_index() -> NeuroIndex:
    return NeuroIndex(_load_chunks())


def search(query: str, k: int = 3) -> list[dict]:
    return get_index().search(query, k=k)


if __name__ == "__main__":
    idx = get_index()
    print(f"loaded {len(idx.chunks)} chunks")
    for hit in idx.search("rezolutie temporala EEG vs fMRI", k=3):
        print(f"[{hit['score']}] {hit['chapter']} · {hit['heading']}")
