#!/bin/zsh
set -e
source "$(dirname "$0")/env.sh"
if [[ "$WHISPER_ENGINE" == "faster-whisper" && -f "$LOCAL_AI_ROOT/faster_whisper_server.py" ]] && "$PYTHON" -c 'import faster_whisper' >/dev/null 2>&1; then
  exec "$PYTHON" "$LOCAL_AI_ROOT/faster_whisper_server.py"
fi
exec whisper-server -m "$WHISPER_MODEL" --host 127.0.0.1 --port 8080 --convert --tmp-dir "$LOCAL_AI_ROOT/output"
