#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
LOCAL_AI_ROOT=${LOCAL_AI_ROOT:-"$HOME/Developer/local-ai"}
PYTHON=${PYTHON:-/opt/homebrew/bin/python3.12}
VENV="$LOCAL_AI_ROOT/omnivoice-venv312"
mkdir -p "$LOCAL_AI_ROOT"
[[ -x "$PYTHON" ]] || { print "Thiếu Python 3.12 tại $PYTHON"; exit 1; }
[[ -x "$VENV/bin/python" ]] || "$PYTHON" -m venv "$VENV"
"$VENV/bin/python" -m pip install --upgrade pip
"$VENV/bin/pip" install torch==2.8.0 torchaudio==2.8.0 'git+https://github.com/k2-fsa/OmniVoice.git'
print "Đã cài runtime OmniVoice tại $VENV"
print "Chưa tự tải checkpoint: model weights OmniVoice hiện có giấy phép CC-BY-NC, cần xác nhận quyền thương mại trước khi dùng production."
