#!/bin/zsh

typeset env_file="${(%):-%N}"
export LOCAL_AI_ROOT="$(cd "$(dirname "$env_file")/.." && pwd)"
export OLLAMA_MODELS="${OLLAMA_MODELS:-$LOCAL_AI_ROOT/models/ollama}"
export HF_HOME="${HF_HOME:-$LOCAL_AI_ROOT/models/image/hf-cache}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$LOCAL_AI_ROOT/models/image/cache}"
export PIPER_MODEL_DIR="${PIPER_MODEL_DIR:-$LOCAL_AI_ROOT/models/piper}"
export WHISPER_MODEL="$LOCAL_AI_ROOT/models/whisper/ggml-base.bin"
export PYTHON="$LOCAL_AI_ROOT/venv/bin/python"
