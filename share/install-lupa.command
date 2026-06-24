#!/usr/bin/env bash
# Lupa — one-double-click installer for a friend's Mac.
# Robust by design: downloads Lupa FIRST (so the extension always exists), then
# every later step is non-fatal — a hiccup in Claude/backend won't abort the
# install. At the end it copies the extension path to the clipboard and opens
# Finder + Chrome so loading the extension is trivial.
set -uo pipefail   # deliberately NOT -e: optional steps must not abort the run

GH_OWNER="1elevarts"; GH_REPO="lupa"; GH_BRANCH="main"
RAW="https://raw.githubusercontent.com/$GH_OWNER/$GH_REPO/$GH_BRANCH"
TARBALL="https://codeload.github.com/$GH_OWNER/$GH_REPO/tar.gz/refs/heads/$GH_BRANCH"
PROJ="$HOME/PROJECTS/study-lens"
EXT="$PROJ/extension"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[33m⚠\033[0m %s\n" "$*"; }

say "👓 Lupa — instalare"

# ── 1) Python (necesar) ──────────────────────────────────────
if ! command -v python3 >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then say "Instalez Python…"; brew install python || true; fi
fi
if ! command -v python3 >/dev/null 2>&1; then
  warn "Python3 lipsește. Instalează-l de pe https://www.python.org/downloads/ și reia."; exit 1
fi
ok "Python $(python3 --version 2>&1 | awk '{print $2}')"

# ── 2) Descarc Lupa PRIMUL (garantează folderul extensiei) ───
say "Descarc Lupa…"
mkdir -p "$HOME/PROJECTS" "$PROJ"
TMP="$(mktemp -d)"
if curl -fsSL --max-time 120 "$TARBALL" -o "$TMP/src.tgz"; then
  tar -xzf "$TMP/src.tgz" -C "$TMP"
  SRC="$(find "$TMP" -maxdepth 1 -type d -name "$GH_REPO-*" | head -1)"
  if [ -d "$SRC/extension" ]; then
    rsync -a "$SRC/" "$PROJ/"
    VER="$(curl -fsS "$RAW/manifest.json" | python3 -c 'import sys,json;print(json.load(sys.stdin)["version"])' 2>/dev/null || echo init)"
    echo "$VER" > "$PROJ/.lupa-version"
    chmod +x "$PROJ/update-lupa.sh" 2>/dev/null || true
    ok "Lupa $VER instalată în $PROJ"
  else
    warn "Arhiva descărcată pare incompletă."
  fi
else
  warn "Nu am putut descărca de pe GitHub (verifică internetul)."
fi
rm -rf "$TMP"

if [ ! -f "$EXT/manifest.json" ]; then
  warn "Folderul extensiei NU s-a creat ($EXT). Verifică internetul și reia installerul."
  exit 1
fi

# ── 3) Backend local (ne-fatal) ──────────────────────────────
say "Configurez backendul local…"
bash "$PROJ/backend/install.sh" || warn "Backendul a dat erori la instalare — vezi http://127.0.0.1:8077/health mai târziu."

# ── 4) Claude CLI + login — CONTUL TĂU (ne-fatal) ────────────
if ! command -v claude >/dev/null 2>&1; then
  say "Instalez Claude CLI…"
  curl -fsSL https://claude.ai/install.sh | bash || warn "Nu am putut instala Claude CLI automat."
  export PATH="$HOME/.local/bin:$PATH"
fi
say "Verific contul tău Claude…"
if command -v claude >/dev/null 2>&1 && claude -p "spune doar: ok" >/dev/null 2>&1; then
  ok "Ești logat în Claude."
else
  warn "Mai trebuie să te loghezi (o singură dată). După instalare, rulează în Terminal:"
  printf "      \033[1mclaude login\033[0m\n"
  warn "Până te loghezi, Lupa pornește dar explicațiile nu vor merge."
fi

# ── 5) Auto-update (la 30 min + la pornire) ──────────────────
say "Activez actualizările automate…"
UPLABEL="com.elevarts.lupa-update"
UPLIST="$HOME/Library/LaunchAgents/$UPLABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$UPLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$UPLABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$PROJ/update-lupa.sh</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>
  <key>StartInterval</key><integer>1800</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$PROJ/update.log</string>
  <key>StandardErrorPath</key><string>$PROJ/update.log</string>
</dict></plist>
PL
launchctl unload "$UPLIST" 2>/dev/null || true
launchctl load "$UPLIST" 2>/dev/null && ok "Update automat activ." || warn "Update agent nu s-a încărcat (nefatal)."

# ── 6) Ultimul pas: clipboard + deschide Finder & Chrome ─────
printf '%s' "$EXT" | pbcopy 2>/dev/null && CLIP=1 || CLIP=0
open "$EXT" 2>/dev/null || true
open -a "Google Chrome" "chrome://extensions" 2>/dev/null || true

say "✅ Aproape gata! Mai e UN pas, în Chrome:"
cat <<DONE
  Ți-am deschis Finder-ul pe folderul corect + pagina Chrome.
  $( [ "$CLIP" = 1 ] && echo "Calea e DEJA copiată în clipboard:" || echo "Calea folderului:" )
     $EXT

  1. În pagina chrome://extensions → activează „Developer mode" (dreapta-sus)
  2. Apasă „Load unpacked"
  3. În fereastra care se deschide apasă  ⌘ + Shift + G ,
     lipește calea ( ⌘ + V ), Enter → apoi „Open/Deschide"
     (SAU navighează manual la folderul „extension" deschis în Finder)
  4. Pin-uiește iconița 🔍

  ❗️ NU alege folderul în care ai dezarhivat zip-ul (ăla n-are extensia) —
     folosește exact calea de mai sus: $EXT

  Verifică backendul:  http://127.0.0.1:8077/health  → trebuie {"ok":true,...}
DONE
