#!/usr/bin/env bash
# Start the Study-Lens backend on 127.0.0.1:8077
set -euo pipefail
cd "$(dirname "$0")"
export LENS_PORT="${LENS_PORT:-8077}"
export LENS_MODEL="${LENS_MODEL:-claude-sonnet-4-6}"
exec ./.venv/bin/python -m uvicorn server:app --host 127.0.0.1 --port "$LENS_PORT"
