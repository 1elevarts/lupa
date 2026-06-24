#!/usr/bin/env bash
# Portable installer for the Study-Lens backend. Works on any Mac (MacBook / Mac Mini).
# Creates a venv, installs deps, generates a launchd agent with correct absolute
# paths for THIS machine, and starts it. Idempotent — safe to re-run.
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="com.elevarts.study-lens"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
PORT="${LENS_PORT:-8077}"
MODEL="${LENS_MODEL:-claude-haiku-4-5}"

echo "▶ Study-Lens install"
echo "  backend: $BACKEND_DIR"

# 1) python
PY="$(command -v python3 || true)"
[ -z "$PY" ] && { echo "✖ python3 lipsește. Instalează: brew install python"; exit 1; }

# 2) venv + deps
if [ ! -x "$BACKEND_DIR/.venv/bin/python" ]; then
  echo "  • creez venv…"; "$PY" -m venv "$BACKEND_DIR/.venv"
fi
echo "  • instalez fastapi + uvicorn…"
"$BACKEND_DIR/.venv/bin/pip" install --quiet --upgrade pip >/dev/null 2>&1 || true
"$BACKEND_DIR/.venv/bin/pip" install --quiet "fastapi>=0.110" "uvicorn[standard]>=0.29"
VENV_PY="$BACKEND_DIR/.venv/bin/python"

# 3) auth check (OAuth claude CLI preferred; API key also works)
CLAUDE_BIN="$(command -v claude || true)"
CLAUDE_DIR=""
if [ -n "$CLAUDE_BIN" ]; then
  CLAUDE_DIR="$(dirname "$CLAUDE_BIN")"
  echo "  • claude CLI: $CLAUDE_BIN (OAuth \$0)"
elif [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  echo "  • folosesc ANTHROPIC_API_KEY (SDK)"
  "$BACKEND_DIR/.venv/bin/pip" install --quiet "anthropic>=0.40"
else
  echo "  ⚠ Nici 'claude' CLI, nici ANTHROPIC_API_KEY. Backend-ul pornește, dar"
  echo "    explicațiile vor eșua până rulezi 'claude login' SAU exporți o cheie."
fi

# 4) generate launchd plist with THIS machine's absolute paths
PATH_ENV="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"
[ -n "$CLAUDE_DIR" ] && PATH_ENV="$CLAUDE_DIR:$PATH_ENV"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${VENV_PY}</string><string>-m</string><string>uvicorn</string>
    <string>server:app</string><string>--host</string><string>127.0.0.1</string>
    <string>--port</string><string>${PORT}</string>
  </array>
  <key>WorkingDirectory</key><string>${BACKEND_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LENS_MODEL</key><string>${MODEL}</string>
    <key>PATH</key><string>${PATH_ENV}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${BACKEND_DIR}/server.log</string>
  <key>StandardErrorPath</key><string>${BACKEND_DIR}/server.log</string>
</dict>
</plist>
PLISTEOF

# 5) (re)load
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
sleep 2

# 6) health
echo -n "  • health: "
if curl -s "http://127.0.0.1:${PORT}/health" 2>/dev/null | grep -q '"ok":true'; then
  curl -s "http://127.0.0.1:${PORT}/health"; echo
else
  echo "încă pornește — verifică ${BACKEND_DIR}/server.log"
fi

cat <<DONE

✓ Backend instalat ca serviciu ($LABEL, port $PORT, pornește la fiecare boot).

Acum extension-ul în Chrome (pe ACEST Mac):
  1. chrome://extensions  →  Developer mode ON (sus-dreapta)
  2. Load unpacked  →  alege:  $(cd "$BACKEND_DIR/.." && pwd)/extension
  3. Pin-uiește iconița (puzzle → ace) ca s-o ai la îndemână.

On/off (3 căi):
  • pastila plutitoare „Lupa" din colț — click = on/off, trage ca s-o muți
  • Alt+Shift+L  — pornește/oprește
  • iconița extensiei → switch „Activă"

Oprește serviciul de tot:  launchctl unload "$PLIST"
DONE
