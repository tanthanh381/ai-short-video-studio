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

# Ứng dụng Tailscale cho Mac không đặt lệnh "tailscale" vào PATH; dùng bản đi kèm trong ứng dụng nếu cần.
tailscale_cmd=$(command -v tailscale || true)
[[ -n "$tailscale_cmd" ]] || { [[ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]] && tailscale_cmd=/Applications/Tailscale.app/Contents/MacOS/Tailscale; }
[[ -n "$tailscale_cmd" ]] || { print 'Máy này chưa cài Tailscale. Cài và đăng nhập cùng tài khoản với Mac mini, rồi chạy lại.'; exit 1; }
tailscale_ip=$("$tailscale_cmd" ip -4 2>/dev/null | head -n1 || true)
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

# Ảnh và giọng của hai máy ghép vào cùng một video nên phải GIỐNG máy chính. Máy chính (chạy dưới launchd) không đặt IMAGE_STEPS,
# VIENEU_STEPS hay TTS_BREAK_WORDS mà dùng mặc định trong media_server.py, nên máy này cũng KHÔNG đặt: một IMAGE_STEPS=4 ở đây ép mọi
# ảnh (cả ảnh có người, vốn cần nhiều bước hơn) xuống 4 bước và làm máy chính loại máy này khỏi việc vẽ ảnh và đọc giọng.
unset IMAGE_STEPS VIENEU_STEPS TTS_BREAK_WORDS
export FACE_DETAIL=${FACE_DETAIL:-true}

# Chỉ mở ra mạng Tailscale (không phải 0.0.0.0). Các dịch vụ còn lại chỉ nghe trên chính máy này.
export LOCAL_MEDIA_HOST="$tailscale_ip"
export WHITEBOARD_HOST="$tailscale_ip"
export OLLAMA_HOST="$tailscale_ip:11434"

start_if_down() { # url name command...
  local url=$1 name=$2; shift 2
  curl -fsS "$url" >/dev/null 2>&1 || nohup "$@" >"tmp/local-services/$name.log" 2>&1 &
}

# Một Ollama chỉ nghe trên chính máy này (ứng dụng trên thanh menu, hoặc bản tạm của bộ cài chưa kịp tắt) chiếm cổng 11434 và
# máy chính không gọi tới được. Máy này đã được dành làm máy phụ, nên tắt nó đi rồi mở lại Ollama trên địa chỉ Tailscale.
ollama_up() { curl -fsS -m 2 "$1/api/tags" >/dev/null 2>&1; }
if ollama_up http://127.0.0.1:11434 && ! ollama_up "http://$tailscale_ip:11434"; then
  print 'Ollama đang chỉ nghe trên chính máy này; tắt nó để mở lại cho máy chính...'
  osascript -e 'tell application "Ollama" to quit' >/dev/null 2>&1 || true
  pkill -TERM -f 'ollama serve' 2>/dev/null || true
  for _ in {1..10}; do ollama_up http://127.0.0.1:11434 || break; sleep 1; done
  if ollama_up http://127.0.0.1:11434; then pkill -KILL -f 'ollama serve' 2>/dev/null || true; sleep 2; fi
  if ollama_up http://127.0.0.1:11434; then
    print 'Không tắt được Ollama đang chạy. Thoát ứng dụng Ollama trên thanh menu rồi chạy lại script này.'
    exit 1
  fi
fi
start_if_down "http://$tailscale_ip:11434/api/tags" ollama ollama serve

start_if_down http://127.0.0.1:8080/ whisper zsh "$LOCAL_AI_ROOT/bin/start-whisper.sh"
start_if_down http://127.0.0.1:5000/health piper zsh "$LOCAL_AI_ROOT/bin/start-tts.sh"
start_if_down http://127.0.0.1:5001/health vieneu zsh "$LOCAL_AI_ROOT/bin/start-vieneu.sh"
start_if_down http://127.0.0.1:5002/health image "$LOCAL_AI_ROOT/venv/bin/python" local-tools/image_server.py
start_if_down "http://$tailscale_ip:8765/health" media env NODE_START_SCRIPT="$studio_root/scripts/Mo-May-Phu.command" /opt/homebrew/bin/python3.12 local-tools/media_server.py
start_if_down "http://$tailscale_ip:8766/health" whiteboard "$LOCAL_AI_ROOT/wb-venv/bin/python" local-tools/whiteboard_server.py
if [[ -x "$LOCAL_AI_ROOT/ltx-venv/bin/python" && -f "$LOCAL_AI_ROOT/models/ltx-video/ltxv-2b-0.9.8-distilled.safetensors" ]]; then
  start_if_down http://127.0.0.1:8770/health ltx env LTX_VIDEO_HOST=127.0.0.1 LTX_VIDEO_ROOT="$LOCAL_AI_ROOT/LTX-Video" LTX_VIDEO_CHECKPOINT="$LOCAL_AI_ROOT/models/ltx-video/ltxv-2b-0.9.8-distilled.safetensors" LTX_VIDEO_SPATIAL_UPSCALER="$LOCAL_AI_ROOT/models/ltx-video/ltxv-spatial-upscaler-0.9.8.safetensors" LTX_VIDEO_TEXT_ENCODER="${LTX_VIDEO_TEXT_ENCODER:-$HOME/.cache/huggingface/hub/models--PixArt-alpha--PixArt-XL-2-1024-MS/snapshots/current}" "$LOCAL_AI_ROOT/ltx-venv/bin/python" "$studio_root/local-tools/ltx_server.py"
fi

# Không để máy ngủ khi đang phục vụ (không ngăn được việc gập màn hình khi không có màn hình ngoài).
pgrep -f "caffeinate -is" >/dev/null 2>&1 || nohup caffeinate -is >/dev/null 2>&1 &

print "Máy phụ '$NODE_NAME' đang chạy tại $tailscale_ip (mô hình ảnh cần vài phút để nạp lần đầu)."
print 'Giữ máy cắm sạc và mở nắp. Tạm dừng khi cần dùng máy: scripts/Mo-May-Phu.command pause'
print ''
print 'Trên máy chính (Mac mini), thêm vào .env.selfhost rồi chạy lại docker-compose up -d:'
print "  AI_NODES=air=$tailscale_ip"
print '  AI_NODES_TOKEN=<nội dung tệp ~/.studio-node-token của máy này: cat ~/.studio-node-token>'
