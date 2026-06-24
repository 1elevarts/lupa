#!/usr/bin/env bash
# Publish a new Lupa version (George runs this on his MacBook).
# Bumps the version in manifest.json, commits everything and pushes to GitHub.
# Friends' machines pull the new version automatically within ~30 min.
#   Usage:  bash release/publish.sh "ce am schimbat (notă scurtă)"
set -euo pipefail

PROJ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJ"
NOTES="${1:-update}"
VERSION="$(date +%Y-%m-%d-%H%M)"

printf '{"version":"%s","notes":"%s"}\n' "$VERSION" "$NOTES" > manifest.json
git add -A
if git diff --cached --quiet; then
  echo "Nimic de publicat (fără modificări)."; exit 0
fi
git commit -q -m "release: $VERSION — $NOTES"
git push -q origin main
echo "✓ Publicat $VERSION — \"$NOTES\""
echo "  Cipri primește automat în ~30 min (sau forțează: bash ~/PROJECTS/study-lens/update-lupa.sh)"
