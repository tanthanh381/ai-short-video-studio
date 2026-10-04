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
if ! curl -fsS http://127.0.0.1:8188/system_stats >/dev/null 2>&1; then
  if [[ ! -x local-tools/comfy-venv/bin/python ]]; then
    print 'Chưa có ComfyUI trên máy. Liên hệ người triển khai.'
    exit 1
  fi
  nohup local-tools/comfy-venv/bin/python local-tools/ComfyUI/main.py --cpu --listen 127.0.0.1 --port 8188 >tmp/local-services/comfy.log 2>&1 &
fi
if ! curl -fsS http://127.0.0.1:8765/health >/dev/null 2>&1; then
  nohup /opt/homebrew/bin/python3.12 local-tools/media_server.py >tmp/local-services/media.log 2>&1 &
fi
docker-compose --env-file .env.selfhost -f docker-compose.selfhost.yml up -d api worker
tailscale funnel --bg --https=443 http://127.0.0.1:8787
print 'Máy tạo video đã được khởi động. Giữ máy bật, không ngủ khi xử lý.'
print 'Mở: https://tanthanh381.github.io/ai-short-video-studio/'
open 'https://tanthanh381.github.io/ai-short-video-studio/'
