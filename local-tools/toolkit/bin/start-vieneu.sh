#!/bin/zsh
set -e
source "$(dirname "$0")/env.sh"
cd "$LOCAL_AI_ROOT"
export HF_HOME="$LOCAL_AI_ROOT/models/vieneu-cache"
export VIENEU_MODEL_DIR="${VIENEU_MODEL_DIR:-$LOCAL_AI_ROOT/models/vieneu-v3-turbo}"
export VIENEU_CODEC_DIR="${VIENEU_CODEC_DIR:-$LOCAL_AI_ROOT/models/moss-audio-tokenizer-onnx}"
export VIENEU_THREADS="${VIENEU_THREADS:-6}"
exec "$LOCAL_AI_ROOT/venv/bin/uvicorn" vieneu_api:app --host 127.0.0.1 --port 5001
