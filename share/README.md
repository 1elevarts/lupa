# 👓 Lupa — tutore AR de studiu

O lupă AI care îți explică materia pe orice pagină și te ghidează la grile —
**fără să-ți dea răspunsul**. Rulează 100% pe Mac-ul tău, cu **contul tău Claude**
($0 dacă ai abonament). Se actualizează singură când George adaugă materie sau
funcții noi.

> Ai primit un fișier `Lupa-pentru-Cipri.zip`. Dezarhivează-l (dublu-click) —
> înăuntru găsești `install-lupa.command` și acest README.

---

## Instalare — 3 pași

### Pasul 1 — Rulează installerul
**Dublu-click pe `install-lupa.command`.**
- Dacă macOS zice „nu poate fi deschis, dezvoltator neidentificat":
  **click-dreapta pe fișier → Open → Open**.
- Se deschide o fereastră Terminal. La un moment dat **se deschide browserul** ca să te
  loghezi în **contul tău Claude** — loghează-te.
- Installerul descarcă singur tot, pornește backendul și activează update-urile automate.
  (Nu trebuie să muți niciun fișier manual — el le pune în `~/PROJECTS/study-lens`.)

### Pasul 2 — Încarcă extensia în Chrome
La final, installerul **îți deschide singur** folderul extensiei în Finder **și**
pagina `chrome://extensions`. Acolo:
1. Activează **Developer mode** (colț dreapta-sus).
2. Apasă **Load unpacked**.
3. Selectează folderul **`extension`** pe care ți l-a deschis în Finder.
   *(calea lui: `~/PROJECTS/study-lens/extension`)*
4. Pin-uiește iconița 🔍 (puzzle → ac de prindere).

### Pasul 3 — Gata
Backendul pornește singur la fiecare boot, iar **update-urile vin automat** (la 30 min).

---

## Cum o folosești
- **Lupa din colțul dreapta-jos**: click = explică selecția / paragraful (sau `⌥+L`).
- **Selectează text** → explicație discretă jos.
- **La grile**: bifează un răspuns → îți spune dacă te-ai înșelat + un indiciu nou,
  și taie 1-2 variante clar greșite. *(Pe Mac, `Alt` = tasta `⌥ Option`.)*
- **On/off**: `⌥+Shift+L` sau iconița extensiei → „Activă".
- Din **iconița extensiei**: mod (Auto/Explică/Grilă/Schelă), scan la hover,
  „caută singur întrebarea", opacitatea barei.

---

## Te-ai blocat?
Trimite fișierele lui Claude și cere-i să te ghideze — folosește promptul din
`GHID-CLAUDE.txt` (e în zip). Sau, pe scurt:

- Backend pornit? Deschide http://127.0.0.1:8077/health → trebuie `{"ok":true,...}`.
- Re-loghează-te: `claude login` în Terminal.
- Nu găsești folderul `extension`? E în `~/PROJECTS/study-lens/extension`
  (în Finder: meniul `Go → Go to Folder…` → lipește calea).
- Forțează update acum: `bash ~/PROJECTS/study-lens/update-lupa.sh`
- Loguri: `~/PROJECTS/study-lens/server.log` · `update.log`
- Oprește tot: `launchctl unload ~/Library/LaunchAgents/com.elevarts.study-lens.plist`
