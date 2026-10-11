#!/bin/zsh
# Cài LTX-Video 2B Distilled và bật motion service local trên máy này.
# Model được tải từ nguồn chính thức; cần vài GB ổ đĩa và thời gian tải tùy mạng.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
self=${0:A}
studio_root=${self:h:h}
cd "$studio_root"

LOCAL_AI_ROOT=${LOCAL_AI_ROOT:-"$HOME/Developer/local-ai"}
LTX_ROOT=${LTX_VIDEO_ROOT:-"$LOCAL_AI_ROOT/LTX-Video"}
LTX_ENV=${LTX_ENV:-"$LOCAL_AI_ROOT/ltx-venv"}
MODEL_DIR=${LTX_MODEL_DIR:-"$LOCAL_AI_ROOT/models/ltx-video"}
CHECKPOINT=${LTX_VIDEO_CHECKPOINT:-"$MODEL_DIR/ltxv-2b-0.9.8-distilled.safetensors"}
TEXT_ENCODER=${LTX_VIDEO_TEXT_ENCODER:-"$HOME/.cache/huggingface/hub/models--PixArt-alpha--PixArt-XL-2-1024-MS/snapshots/current"}

command -v python3.12 >/dev/null || { print 'Thiếu python3.12.'; exit 1; }
command -v git >/dev/null || { print 'Thiếu git.'; exit 1; }
mkdir -p "$LOCAL_AI_ROOT" "$MODEL_DIR" "${TEXT_ENCODER:h}"

if [[ ! -x "$LTX_ENV/bin/python" ]]; then
  python3.12 -m venv "$LTX_ENV"
fi
"$LTX_ENV/bin/python" -m pip install --upgrade pip

if [[ ! -d "$LTX_ROOT/.git" ]]; then
  git clone https://github.com/Lightricks/LTX-Video.git "$LTX_ROOT"
fi
git -C "$LTX_ROOT" pull --ff-only
"$LTX_ENV/bin/pip" install -e "${LTX_ROOT}[inference]"

if ! command -v hf >/dev/null; then
  "$LTX_ENV/bin/pip" install huggingface_hub
  HF="$LTX_ENV/bin/hf"
else
  HF=$(command -v hf)
fi

if [[ ! -f "$CHECKPOINT" ]]; then
  "$HF" download Lightricks/LTX-Video ltxv-2b-0.9.8-distilled.safetensors --local-dir "$MODEL_DIR"
fi

if [[ ! -d "$TEXT_ENCODER/text_encoder" || ! -d "$TEXT_ENCODER/tokenizer" ]]; then
  mkdir -p "$TEXT_ENCODER"
  "$HF" download PixArt-alpha/PixArt-XL-2-1024-MS --local-dir "$TEXT_ENCODER"
fi

mkdir -p "$studio_root/tmp/local-services"
if ! curl -fsS --max-time 3 http://127.0.0.1:8770/health >/dev/null 2>&1; then
  nohup env \
    LTX_VIDEO_ROOT="$LTX_ROOT" \
    LTX_VIDEO_CHECKPOINT="$CHECKPOINT" \
    LTX_VIDEO_TEXT_ENCODER="$TEXT_ENCODER" \
    LTX_VIDEO_DEVICE="${LTX_VIDEO_DEVICE:-mps}" \
    "$LTX_ENV/bin/python" "$studio_root/local-tools/ltx_server.py" \
    >"$studio_root/tmp/local-services/ltx.log" 2>&1 &
fi

for _ in {1..30}; do
  if curl -fsS --max-time 3 http://127.0.0.1:8770/health; then
    print ''
    print 'LTX đã sẵn sàng tại http://127.0.0.1:8770.'
    exit 0
  fi
  sleep 2
done
print 'LTX chưa sẵn sàng. Kiểm tra log:'
print "$studio_root/tmp/local-services/ltx.log"
exit 1
