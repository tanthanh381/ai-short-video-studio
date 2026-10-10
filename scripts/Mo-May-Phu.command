#!/bin/zsh
# Bật máy này (MacBook Air) làm MÁY PHỤ: chạy các dịch vụ AI để máy chính (Mac mini) chia bớt việc qua Tailscale.
# Máy này không cần Docker, Supabase hay khóa nào: chỉ nhận việc từ máy chính, bằng token.
#   scripts/Mo-May-Phu.command           bật máy phụ
#   scripts/Mo-May-Phu.command pause     tạm dừng nhận việc (đang dùng máy cho việc khác)
#   scripts/Mo-May-Phu.command resume    nhận việc trở lại
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
studio_root=${0:A:h:h}
cd "$studio_root"

pause_file=${NODE_PAUSE_FILE:-"$HOME/.studio-node-paused"}
case "${1:-}" in
  pause)  touch "$pause_file"; print 'Đã tạm dừng: máy chính sẽ không giao việc mới cho máy này (việc đang chạy vẫn xong).'; exit 0 ;;
  resume) rm -f "$pause_file"; print 'Đã bật lại: máy này nhận việc từ máy chính.'; exit 0 ;;
esac

mkdir -p tmp/local-services

command -v tailscale >/dev/null 2>&1 || { print 'Máy này chưa cài Tailscale. Cài và đăng nhập cùng tài khoản với Mac mini, rồi chạy lại.'; exit 1; }
tailscale_ip=$(tailscale ip -4 2>/dev/null | head -n1 || true)
[[ -n "$tailscale_ip" ]] || { print 'Tailscale chưa đăng nhập hoặc chưa kết nối. Mở Tailscale, đăng nhập cùng tài khoản với Mac mini, rồi chạy lại.'; exit 1; }

LOCAL_AI_ROOT=${LOCAL_AI_ROOT:-"$HOME/Developer/local-ai"}
[[ -d "$LOCAL_AI_ROOT" ]] || { print "Thiếu thư mục $LOCAL_AI_ROOT (model và môi trường Python). Xem docs/TU-HOST.md, mục \"Thêm máy phụ\"."; exit 1; }

# Token chung giữa hai máy: sinh một lần, giữ trong tệp chỉ mình bạn đọc được.
token_file="$HOME/.studio-node-token"
if [[ ! -s "$token_file" ]]; then
  ( umask 077; openssl rand -base64 36 | tr -d '\n=+/' | cut -c1-40 > "$token_file" )
fi
export NODE_TOKEN=$(<"$token_file")
export NODE_NAME=${NODE_NAME:-air}

# Phải GIỐNG máy chính: ảnh và giọng của hai máy sẽ ghép vào cùng một video. Máy chính bỏ qua máy phụ nếu hai máy khác nhau.
export IMAGE_STEPS=${IMAGE_STEPS:-4}
export VIENEU_STEPS=${VIENEU_STEPS:-16}
export TTS_BREAK_WORDS=${TTS_BREAK_WORDS:-18}

# Chỉ mở ra mạng Tailscale (không phải 0.0.0.0). Các dịch vụ còn lại chỉ nghe trên chính máy này.
export LOCAL_MEDIA_HOST="$tailscale_ip"
export WHITEBOARD_HOST="$tailscale_ip"
export OLLAMA_HOST="$tailscale_ip:11434"

start_if_down() { # url name command...
  local url=$1 name=$2; shift 2
  curl -fsS "$url" >/dev/null 2>&1 || nohup "$@" >"tmp/local-services/$name.log" 2>&1 &
}

if curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && ! curl -fsS "http://$tailscale_ip:11434/api/tags" >/dev/null 2>&1; then
  print 'Ollama đang chạy nhưng chỉ nghe trên chính máy này (thường là ứng dụng Ollama trên thanh menu).'
  print 'Hãy thoát ứng dụng Ollama rồi chạy lại script này để mở Ollama cho máy chính.'
  exit 1
fi
start_if_down "http://$tailscale_ip:11434/api/tags" ollama ollama serve

start_if_down http://127.0.0.1:8080/ whisper zsh "$LOCAL_AI_ROOT/bin/start-whisper.sh"
start_if_down http://127.0.0.1:5000/health piper zsh "$LOCAL_AI_ROOT/bin/start-tts.sh"
start_if_down http://127.0.0.1:5001/health vieneu zsh "$LOCAL_AI_ROOT/bin/start-vieneu.sh"
start_if_down http://127.0.0.1:5002/health image "$LOCAL_AI_ROOT/venv/bin/python" local-tools/image_server.py
start_if_down "http://$tailscale_ip:8765/health" media /opt/homebrew/bin/python3.12 local-tools/media_server.py
start_if_down "http://$tailscale_ip:8766/health" whiteboard "$LOCAL_AI_ROOT/wb-venv/bin/python" local-tools/whiteboard_server.py

# Không để máy ngủ khi đang phục vụ (không ngăn được việc gập màn hình khi không có màn hình ngoài).
pgrep -f "caffeinate -is" >/dev/null 2>&1 || nohup caffeinate -is >/dev/null 2>&1 &

print "Máy phụ '$NODE_NAME' đang chạy tại $tailscale_ip (mô hình ảnh cần vài phút để nạp lần đầu)."
print 'Giữ máy cắm sạc và mở nắp. Tạm dừng khi cần dùng máy: scripts/Mo-May-Phu.command pause'
print ''
print 'Trên máy chính (Mac mini), thêm vào .env.selfhost rồi chạy lại docker-compose up -d:'
print "  AI_NODES=air=$tailscale_ip"
print '  AI_NODES_TOKEN=<nội dung tệp ~/.studio-node-token của máy này: cat ~/.studio-node-token>'
