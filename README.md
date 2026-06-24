# Lupa — tutore AR de studiu

O lupă AR care vine cu cursorul pe **orice pagină** și îți explică subtil conceptele din
materie, ancorate în cursurile tale de pe `invatacu-neuro`. Te ghidează să **înveți**,
nu îți dă răspunsul la teste.

```
┌─────────────┐   selectezi text / Alt+L   ┌────────────────┐   claude -p (OAuth $0)
│  orice tab  │ ─────────────────────────► │  backend local │ ──────────────────────► Claude Sonnet
│  (extension)│ ◄───────────────────────── │  :8077 FastAPI │ ◄── RAG: 215 fragmente neuro
└─────────────┘     explicație în lupă       └────────────────┘
```

## Ce face
- **Orb AR** care urmărește cursorul. Culoarea = STARE (idle → galben „mă gândesc" → verde „gata"),
  **niciodată** corect/greșit. E un tutore, nu un cheat.
- **Selectează un text** → îți explică scurt conceptul, cu termeni-cheie și un indiciu de gândire.
- **`Alt+L`** → explică selecția sau paragraful de sub cursor.
- **`Alt+Shift+L`** → pornește/oprește lupa. **`Esc`** → închide panoul.
- **Scan la hover** (opțional, din popup): stai ~1s pe un paragraf → explică automat.
- **Detecție automată mod:**
  - *grilă* (întrebare cu variante) → îți explică **mecanismul**, NU bifează răspunsul;
  - *câmp text* → îți dă **schela** răspunsului, nu răspunsul gata scris;
  - altfel → explică termenul.

## Linia roșie (în cod, nenegociabilă)
Pe o întrebare de test cu notă, lupa **nu** spune „răspunsul e B" și **nu** completează câmpul.
Explică principiul din spate ca să alegi tu. Garda e în `backend/prompts.py` (`TUTOR_SYSTEM`).

## Instalare (portabil — MacBook sau Mac Mini)

Proiectul e self-contained: materia neuro e împachetată în `backend/neuro_content/`,
deci merge pe orice Mac fără să depindă de Mac Mini.

### 1. Pune proiectul pe Mac
Copiază folderul `study-lens` în `~/PROJECTS/` pe Mac-ul țintă (AirDrop pachetul
`study-lens-portable.tar.gz`, sau `git clone`, sau scp prin Tailscale), apoi:
```bash
tar -xzf study-lens-portable.tar.gz -C ~/PROJECTS   # dacă e tarball
```

### 2. Backend (o singură comandă)
```bash
bash ~/PROJECTS/study-lens/backend/install.sh
```
Creează venv, instalează deps, generează launchd-ul cu căile corecte ALE ACESTUI Mac
și pornește serviciul (revine la fiecare boot). Idempotent — poți rerula oricând.

> Necesită fie **`claude` CLI logat** (OAuth, $0 — `claude login` dacă nu e), fie
> `ANTHROPIC_API_KEY` exportat. Installer-ul detectează singur și te anunță.

### 3. Extension în Chrome (pe același Mac)
1. `chrome://extensions` → **Developer mode** ON (sus-dreapta)
2. **Load unpacked** → `~/PROJECTS/study-lens/extension`
3. Pin-uiește iconița (puzzle → ac) ca s-o ai la îndemână.

> Prima explicație nouă durează ~8-12s (`claude -p` cold start). Repetările sunt **instant** (cache pe disc).

## On/off — 3 căi la îndemână
- **Pastila plutitoare „Lupa"** din colțul paginii: **click = on/off**, o **tragi** oriunde vrei.
- **`Alt+Shift+L`** — pornește/oprește global.
- **Iconița extensiei** → switch „Activă".

Când e OFF, lupa dispare complet (zero triggere) dar pastila rămâne, ca s-o repornești dintr-un click.
Nu vrei nici pastila? Iconiță → oprește „Buton plutitor" (rămâi pe hotkey).

### Oprește serviciul de tot
```bash
launchctl unload ~/Library/LaunchAgents/com.elevarts.study-lens.plist
```

## Config
- Model: env `LENS_MODEL` (default `claude-sonnet-4-6`; pune `claude-haiku-4-5` pentru viteză).
- Port: env `LENS_PORT` (default 8077). Schimbi și în popup („backend").
- Cache răspunsuri: `backend/cache/` (șterge ca să regenerezi).

## Structură
```
backend/
  server.py      FastAPI /explain + /health, cache disc, CORS
  retrieval.py   TF-IDF peste content/n01..n11.json (fără deps externe)
  llm.py         client Claude: API key dacă există, altfel claude -p OAuth
  prompts.py     prompt tutore + garda etică
extension/
  manifest.json  MV3
  content.js     lupa AR (Shadow DOM), triggere, panou
  background.js  proxy fetch la backend + hotkeys
  popup.html/js  on/off, mod, scan, status backend
```

## Extinderi ușoare
- **Altă materie:** pune `content/*.json` în alt folder și schimbă `NEURO_DIR` în `retrieval.py`.
- **Embeddings reale:** swap TF-IDF cu nomic-embed-text (Ollama :11434) — semnătura `search()` rămâne.
- **Viteză:** `LENS_MODEL=claude-haiku-4-5`, sau setezi `ANTHROPIC_API_KEY` (folosește SDK, fără subprocess).
