#!/usr/bin/env bash
# Lupa — one-double-click installer for a friend's Mac.
# Downloads Lupa from GitHub (anonymous), sets up the local backend with HIS OWN
# Claude login, and an auto-updater so future changes arrive automatically.
set -euo pipefail

GH_OWNER="1elevarts"; GH_REPO="lupa"; GH_BRANCH="main"
RAW="https://raw.githubusercontent.com/$GH_OWNER/$GH_REPO/$GH_BRANCH"
TARBALL="https://codeload.github.com/$GH_OWNER/$GH_REPO/tar.gz/refs/heads/$GH_BRANCH"
PROJ="$HOME/PROJECTS/study-lens"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[33m⚠\033[0m %s\n" "$*"; }

say "👓 Lupa — instalare"

# ── 1) Python ────────────────────────────────────────────────
if ! command -v python3 >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then say "Instalez Python…"; brew install python
  else warn "Python3 lipsește. Ia-l de pe https://www.python.org/downloads/ și reia."; exit 1; fi
fi
ok "Python $(python3 --version 2>&1 | awk '{print $2}')"

# ── 2) Claude CLI + login (CONTUL TĂU, gratuit cu abonament) ──
if ! command -v claude >/dev/null 2>&1; then
  say "Instalez Claude CLI…"
  curl -fsSL https://claude.ai/install.sh | bash || {
    warn "Instalare automată eșuată. Ia Claude Code de pe https://claude.com/download și reia."; exit 1; }
  export PATH="$HOME/.local/bin:$PATH"
fi
say "Verific contul tău Claude…"
if claude -p "spune doar: ok" >/dev/null 2>&1; then
  ok "Ești logat în Claude."
else
  warn "Se deschide browserul ca să te loghezi în contul TĂU Claude…"
  claude login || { warn "Login eșuat. Rulează 'claude login' în Terminal și reia."; exit 1; }
  ok "Logat."
fi

# ── 3) Download Lupa from GitHub ─────────────────────────────
say "Descarc Lupa…"
mkdir -p "$HOME/PROJECTS" "$PROJ"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
curl -fsSL --max-time 120 "$TARBALL" -o "$TMP/src.tgz" || { warn "Nu am putut descărca de pe GitHub."; exit 1; }
tar -xzf "$TMP/src.tgz" -C "$TMP"
SRC="$(find "$TMP" -maxdepth 1 -type d -name "$GH_REPO-*" | head -1)"
rsync -a "$SRC/" "$PROJ/"
VER="$(curl -fsS "$RAW/manifest.json" | python3 -c 'import sys,json;print(json.load(sys.stdin)["version"])' 2>/dev/null || echo init)"
echo "$VER" > "$PROJ/.lupa-version"
chmod +x "$PROJ/update-lupa.sh" 2>/dev/null || true
ok "Lupa $VER instalată în $PROJ"

# ── 4) Backend service (venv + deps + launchd) ───────────────
say "Configurez backendul local…"
bash "$PROJ/backend/install.sh"

# ── 5) Auto-update agent (every 30 min + at login) ───────────
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
launchctl load "$UPLIST"
ok "Update automat activ (la 30 min + la pornire)."

# ── done ─────────────────────────────────────────────────────
say "✅ Gata! Mai e UN pas, în Chrome (nu-l pot face eu):"
cat <<DONE
  1. Deschide:  chrome://extensions
  2. Activează „Developer mode" (sus-dreapta)
  3. „Load unpacked" → alege folderul:
       $PROJ/extension
  4. Pin-uiește iconița 🔍

  Folosire:
   • lupa din colțul dreapta-jos: click = explică (sau ⌥+L / Alt+L)
   • selectează text → explicație; la grile, bifează un răspuns → feedback
   • on/off: ⌥+Shift+L  sau  iconița extensiei → „Activă"

  Backend: http://127.0.0.1:8077/health   ·   Log update: $PROJ/update.log
DONE
