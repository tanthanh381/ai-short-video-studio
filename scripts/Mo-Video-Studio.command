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
export IMAGE_STEPS=${IMAGE_STEPS:-4}
export VIENEU_STEPS=${VIENEU_STEPS:-16}
export TTS_BREAK_WORDS=${TTS_BREAK_WORDS:-18}
start_if_down() { # url name command...
  local url=$1 name=$2; shift 2
  curl -fsS "$url" >/dev/null 2>&1 || nohup "$@" >"tmp/local-services/$name.log" 2>&1 &
}
start_if_down http://127.0.0.1:8080/ whisper zsh "$LOCAL_AI_ROOT/bin/start-whisper.sh"
start_if_down http://127.0.0.1:5000/health piper zsh "$LOCAL_AI_ROOT/bin/start-tts.sh"
start_if_down http://127.0.0.1:5001/health vieneu zsh "$LOCAL_AI_ROOT/bin/start-vieneu.sh"
start_if_down http://127.0.0.1:5002/health image "$LOCAL_AI_ROOT/venv/bin/python" local-tools/image_server.py
if ! curl -fsS http://127.0.0.1:8765/health >/dev/null 2>&1; then
  nohup /opt/homebrew/bin/python3.12 local-tools/media_server.py >tmp/local-services/media.log 2>&1 &
fi
start_if_down http://127.0.0.1:8766/health whiteboard "$LOCAL_AI_ROOT/wb-venv/bin/python" local-tools/whiteboard_server.py
docker-compose --env-file .env.selfhost -f docker-compose.selfhost.yml up -d api worker
tailscale funnel --bg --https=443 http://127.0.0.1:8787
print 'Máy tạo video đã được khởi động. Giữ máy bật, không ngủ khi xử lý.'
print 'Mở: https://tanthanh381.github.io/ai-short-video-studio/'
open 'https://tanthanh381.github.io/ai-short-video-studio/'
