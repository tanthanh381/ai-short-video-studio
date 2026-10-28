#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
studio_root=${0:A:h:h}
cd "$studio_root"
mkdir -p tmp/local-services
if [[ ! -f .env.selfhost ]]; then
  print 'Thiếu cấu hình máy. Liên hệ người triển khai; không cần tự sửa code.'
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  colima start
fi
LOCAL_AI_ROOT=${LOCAL_AI_ROOT:-"$HOME/Developer/local-ai"}
export VIENEU_STEPS=${VIENEU_STEPS:-16}
export TTS_BREAK_WORDS=${TTS_BREAK_WORDS:-18}
start_if_down() { # url name command...
  local url=$1 name=$2; shift 2
  curl -fsS "$url" >/dev/null 2>&1 || nohup "$@" >"tmp/local-services/$name.log" 2>&1 &
}
# Nhận dạng giọng nói cho phụ đề (tuỳ chọn) + giọng đọc tiếng Việt.
start_if_down http://127.0.0.1:8080/ whisper zsh "$LOCAL_AI_ROOT/bin/start-whisper.sh"
start_if_down http://127.0.0.1:5001/health vieneu zsh "$LOCAL_AI_ROOT/bin/start-vieneu.sh"
if [[ "${TTS_ENGINES:-vieneu,omnivoice}" == *omnivoice* && -x "$LOCAL_AI_ROOT/omnivoice-venv312/bin/python" && -f "$LOCAL_AI_ROOT/models/omnivoice/config.json" ]]; then
  start_if_down http://127.0.0.1:5010/health omnivoice env LOCAL_AI_ROOT="$LOCAL_AI_ROOT" zsh "$studio_root/local-tools/toolkit/bin/start-omnivoice.sh"
fi
# Cầu nối media local: chỉ còn phục vụ giọng đọc (TTS) và đồng bộ phụ đề.
if ! curl -fsS http://127.0.0.1:8765/health >/dev/null 2>&1; then
  NODE_START_SCRIPT="$studio_root/scripts/Mo-Video-Studio.command" nohup /opt/homebrew/bin/python3.12 local-tools/media_server.py >tmp/local-services/media.log 2>&1 &
fi
docker-compose --env-file .env.selfhost -f docker-compose.selfhost.yml up -d api worker
tailscale funnel --bg --https=443 http://127.0.0.1:8787
print 'Đã khởi động. Giữ máy bật, không ngủ khi đang xử lý.'
print 'Mở: https://tanthanh381.github.io/ai-short-video-studio/'
open 'https://tanthanh381.github.io/ai-short-video-studio/'
