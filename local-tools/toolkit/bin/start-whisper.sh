#!/bin/zsh
set -e
source "$(dirname "$0")/env.sh"
exec whisper-server -m "$WHISPER_MODEL" --host 127.0.0.1 --port 8080 --convert --tmp-dir "$LOCAL_AI_ROOT/output"
