#!/bin/zsh
set -e
source "$(dirname "$0")/env.sh"
cd "$LOCAL_AI_ROOT"
exec env PIPER_MODEL_DIR="$PIPER_MODEL_DIR" "$LOCAL_AI_ROOT/venv/bin/uvicorn" tts_api:app --host 127.0.0.1 --port 5000
