#!/usr/bin/env bash
# Lupa auto-updater (runs on a friend's Mac via launchd, every ~30 min).
# Pulls the latest version straight from GitHub (anonymous, no token/API) and
# restarts the backend so new subjects/code take effect. The Chrome extension
# reloads itself (its built-in hot-reloader watches the files on disk).
set -euo pipefail

GH_OWNER="1elevarts"; GH_REPO="lupa"; GH_BRANCH="main"
RAW="https://raw.githubusercontent.com/$GH_OWNER/$GH_REPO/$GH_BRANCH"
TARBALL="https://codeload.github.com/$GH_OWNER/$GH_REPO/tar.gz/refs/heads/$GH_BRANCH"
PROJ="$HOME/PROJECTS/study-lens"
VFILE="$PROJ/.lupa-version"
PLIST="$HOME/Library/LaunchAgents/com.elevarts.study-lens.plist"
PY="$(command -v python3 || echo /usr/bin/python3)"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

MAN="$(curl -fsS --max-time 20 "$RAW/manifest.json?ts=$(date +%s)" 2>/dev/null || true)"
[ -z "$MAN" ] && { log "no manifest (offline?) — skip"; exit 0; }
REMOTE_V="$(printf '%s' "$MAN" | "$PY" -c 'import sys,json;print(json.load(sys.stdin).get("version",""))' 2>/dev/null || true)"
[ -z "$REMOTE_V" ] && { log "bad manifest — skip"; exit 0; }

LOCAL_V="$(cat "$VFILE" 2>/dev/null || echo none)"
[ "$REMOTE_V" = "$LOCAL_V" ] && exit 0   # already current

log "update $LOCAL_V -> $REMOTE_V"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
curl -fsSL --max-time 120 "$TARBALL" -o "$TMP/src.tgz" || { log "download failed"; exit 1; }
tar -xzf "$TMP/src.tgz" -C "$TMP"
SRC="$(find "$TMP" -maxdepth 1 -type d -name "$GH_REPO-*" | head -1)"
[ -d "$SRC/backend" ] || { log "bad archive — abort"; exit 1; }

# backend code + neuro_content: overwrite, keep .venv / cache / logs intact
rsync -a --exclude '.venv' --exclude 'cache' --exclude 'server.log' "$SRC/backend/" "$PROJ/backend/"
# extension: full mirror so removals propagate
rsync -a --delete "$SRC/extension/" "$PROJ/extension/"
[ -f "$SRC/update-lupa.sh" ] && cp "$SRC/update-lupa.sh" "$PROJ/update-lupa.sh" && chmod +x "$PROJ/update-lupa.sh"

# content changed -> drop stale answer cache
rm -f "$PROJ/backend/cache/"*.json 2>/dev/null || true
# refresh deps in case requirements changed
"$PROJ/backend/.venv/bin/pip" install --quiet "fastapi>=0.110" "uvicorn[standard]>=0.29" >/dev/null 2>&1 || true

echo "$REMOTE_V" > "$VFILE"
# restart backend -> rebuilds the index (picks up new n*.json subjects)
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST" 2>/dev/null || true
log "updated to $REMOTE_V ✓"
