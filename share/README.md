# 👓 Lupa — tutore AR de studiu

O lupă AI care îți explică materia pe orice pagină și te ghidează la grile —
**fără să-ți dea răspunsul**. Rulează 100% pe Mac-ul tău, cu **contul tău Claude**
($0 dacă ai abonament). Se actualizează singură când George adaugă materie sau
funcții noi.

---

## Instalare — 3 pași

**1. Dublu-click pe `install-lupa.command`**
   - Dacă macOS zice „nu poate fi deschis, dezvoltator neidentificat":
     **click-dreapta pe fișier → Open → Open**.
   - Urmează ce-ți cere în Terminal. La un moment dat **se deschide browserul** ca
     să te loghezi în **contul tău Claude** — loghează-te și gata.

**2. Încarcă extensia în Chrome**
   - `chrome://extensions` → activează **Developer mode** (sus-dreapta) →
     **Load unpacked** → alege folderul `~/PROJECTS/study-lens/extension` →
     pin-uiește iconița 🔍.

**3. Gata.** Backendul pornește singur la fiecare boot și **update-urile vin automat**
(verifică la 30 min).

---

## Cum o folosești
- **Lupa din colțul dreapta-jos**: click = explică selecția / paragraful (sau `⌥+L`).
- **Selectează text** → explicație discretă jos.
- **La grile**: bifează un răspuns → îți spune dacă te-ai înșelat + un indiciu nou,
  și taie 1-2 variante clar greșite. (Pe Mac, `Alt` = tasta `⌥ Option`.)
- **On/off**: `⌥+Shift+L` sau iconița extensiei → „Activă".
- Din **iconița extensiei**: mod (Auto/Explică/Grilă/Schelă), scan la hover,
  „caută singur întrebarea", opacitatea barei.

---

## Dacă ceva nu merge
- Backend pornit? Deschide http://127.0.0.1:8077/health → trebuie `{"ok":true,...}`.
- Re-loghează-te: `claude login` în Terminal.
- Forțează update acum: `bash ~/PROJECTS/study-lens/update-lupa.sh`
- Loguri: `~/PROJECTS/study-lens/server.log` · `update.log`
- Oprește tot: `launchctl unload ~/Library/LaunchAgents/com.elevarts.study-lens.plist`
