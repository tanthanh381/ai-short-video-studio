#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
studio_root=${0:A:h:h}
cd "$studio_root"
mkdir -p tmp/local-services
if [[ ! -f .env.selfhost ]]; then
  print 'Thiếu cấu hình máy tạo video. Liên hệ người triển khai; không cần tự sửa code.'
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  colima start
fi
if ! curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  nohup ollama serve >tmp/local-services/ollama.log 2>&1 &
fi
LOCAL_AI_ROOT=${LOCAL_AI_ROOT:-"$HOME/Developer/local-ai"}
COMFYUI_ROOT=${COMFYUI_ROOT:-"$LOCAL_AI_ROOT/ComfyUI"}
# PyTorch MPS can stall during ComfyUI startup on some macOS builds. CPU is the
# reliable default; override with COMFYUI_ARGS="--force-fp16" (or another
# supported ComfyUI argument list) when the local MPS runtime is known-good.
# `--lowvram` is a GPU-only mode and ComfyUI rejects it together with `--cpu`.
# Keep the CPU launcher valid; SDXL Base remains serialized by the media bridge.
COMFYUI_ARGS=${COMFYUI_ARGS:---cpu --cpu-vae}
COMFYUI_AUTOSTART=${COMFYUI_AUTOSTART:-false}
export IMAGE_STEPS=${IMAGE_STEPS:-4}
export VIENEU_STEPS=${VIENEU_STEPS:-16}
export TTS_BREAK_WORDS=${TTS_BREAK_WORDS:-18}
export FACE_DETAIL=${FACE_DETAIL:-true}
start_if_down() { # url name command...
  local url=$1 name=$2; shift 2
  curl -fsS "$url" >/dev/null 2>&1 || nohup "$@" >"tmp/local-services/$name.log" 2>&1 &
}
start_if_down http://127.0.0.1:8080/ whisper zsh "$LOCAL_AI_ROOT/bin/start-whisper.sh"
start_if_down http://127.0.0.1:5001/health vieneu zsh "$LOCAL_AI_ROOT/bin/start-vieneu.sh"
if [[ "${TTS_ENGINES:-vieneu,omnivoice}" == *omnivoice* && -x "$LOCAL_AI_ROOT/omnivoice-venv312/bin/python" && -f "$LOCAL_AI_ROOT/models/omnivoice/config.json" ]]; then
  start_if_down http://127.0.0.1:5010/health omnivoice env LOCAL_AI_ROOT="$LOCAL_AI_ROOT" zsh "$studio_root/local-tools/toolkit/bin/start-omnivoice.sh"
fi
start_if_down http://127.0.0.1:5002/health image "$LOCAL_AI_ROOT/venv/bin/python" local-tools/image_server.py
if [[ "$COMFYUI_AUTOSTART" == "true" && -x "$LOCAL_AI_ROOT/comfy-venv/bin/python" && -f "$COMFYUI_ROOT/main.py" && -f "$COMFYUI_ROOT/models/checkpoints/${COMFYUI_CHECKPOINT:-sd_xl_base_1.0_0.9vae.safetensors}" ]]; then
  start_if_down http://127.0.0.1:8188/system_stats comfyui "$LOCAL_AI_ROOT/comfy-venv/bin/python" "$COMFYUI_ROOT/main.py" ${=COMFYUI_ARGS} --listen 127.0.0.1 --port 8188
fi
if ! curl -fsS http://127.0.0.1:8765/health >/dev/null 2>&1; then
  NODE_START_SCRIPT="$studio_root/scripts/Mo-Video-Studio.command" nohup /opt/homebrew/bin/python3.12 local-tools/media_server.py >tmp/local-services/media.log 2>&1 &
fi
start_if_down http://127.0.0.1:8766/health whiteboard "$LOCAL_AI_ROOT/wb-venv/bin/python" local-tools/whiteboard_server.py
# LTX là tùy chọn: chỉ tự bật khi đã cài đủ venv/model bằng scripts/Cai-LTX-Video.command.
if [[ -x "$LOCAL_AI_ROOT/ltx-venv/bin/python" && -f "$LOCAL_AI_ROOT/models/ltx-video/ltxv-2b-0.9.8-distilled.safetensors" ]]; then
  start_if_down http://127.0.0.1:8770/health ltx env LTX_VIDEO_ROOT="$LOCAL_AI_ROOT/LTX-Video" LTX_VIDEO_CHECKPOINT="$LOCAL_AI_ROOT/models/ltx-video/ltxv-2b-0.9.8-distilled.safetensors" LTX_VIDEO_TEXT_ENCODER="${LTX_VIDEO_TEXT_ENCODER:-$HOME/.cache/huggingface/hub/models--PixArt-alpha--PixArt-XL-2-1024-MS/snapshots/current}" "$LOCAL_AI_ROOT/ltx-venv/bin/python" local-tools/ltx_server.py
fi
docker-compose --env-file .env.selfhost -f docker-compose.selfhost.yml up -d api worker
tailscale funnel --bg --https=443 http://127.0.0.1:8787
print 'Máy tạo video đã được khởi động. Giữ máy bật, không ngủ khi xử lý.'
print 'Mở: https://tanthanh381.github.io/ai-short-video-studio/'
open 'https://tanthanh381.github.io/ai-short-video-studio/'
