#!/bin/bash
# Prepares THIS Mac (the MacBook Air) as the second machine of the video studio, without SSH: the Mac mini's one-time bundle server
# sends the code, the models and the access token over Tailscale, and this script does what docs/TU-HOST.md "Chuẩn bị máy Air" lists
# by hand (tools, Python environments, the local-ai folder, the Ollama model, the token), then starts the machine with
# scripts/Mo-May-Phu.command.
#
# Run it on the Air, in Terminal, with the one line `serve-bundle.sh` prints on the Mac mini:
#   curl -fsSL http://<mini tailnet address>:8899/<secret>/install.sh | bash
# BUNDLE, TOKEN and NAME below are filled in by the bundle server that sends this file.
#
# AIR_NODE_HOME (default $HOME) and AIR_NODE_DRY_RUN=1 (skip brew, pip, models, Ollama and starting) exist so the script can be tested.
set -euo pipefail

BUNDLE="@@BUNDLE_URL@@"
TOKEN="@@NODE_TOKEN@@"
NAME="@@NODE_NAME@@"
HOME_DIR="${AIR_NODE_HOME:-$HOME}"
DRY="${AIR_NODE_DRY_RUN:-0}"
REPO="$HOME_DIR/Developer/ai-short-video-studio"
LOCAL_AI="$HOME_DIR/Developer/local-ai"
OLLAMA_MODEL="${OLLAMA_MODEL:-qwen3.5:4b}"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mLỗi: %s\033[0m\n' "$*" >&2; exit 1; }
run() { if [ "$DRY" = "1" ]; then echo "[dry-run] $*"; else "$@"; fi; }

say "1/7 Kiểm tra máy"
if [ "$DRY" != "1" ]; then
  [ "$(uname -s)" = "Darwin" ] || fail "Chỉ chạy trên macOS"
  [ "$(uname -m)" = "arm64" ] || fail "Cần máy Mac chip Apple (arm64)"
fi
RAM_BYTES=$(sysctl -n hw.memsize 2>/dev/null || echo 17179869184)
RAM_GB=$(( RAM_BYTES / 1073741824 ))
FREE_GB=$(df -k "$HOME_DIR" | awk 'NR==2 {print int($4 / 1048576)}')
MODEL_NAME=$(system_profiler SPHardwareDataType 2>/dev/null | awk -F': ' '/Model Name/ {print $2}' || true)
echo "Máy: ${MODEL_NAME:-Mac}, RAM ${RAM_GB} GB, trống ${FREE_GB} GB"
WITH_IMAGE="${NODE_IMAGE:-}"
if [ -z "$WITH_IMAGE" ]; then
  if [ "$RAM_GB" -ge 16 ]; then WITH_IMAGE=yes; else WITH_IMAGE=no; fi
fi
NEED_GB=8; [ "$WITH_IMAGE" = "yes" ] && NEED_GB=20
[ "$FREE_GB" -ge "$NEED_GB" ] || fail "Cần trống ít nhất ${NEED_GB} GB (đang trống ${FREE_GB} GB)"
if [ "$WITH_IMAGE" = "yes" ]; then
  echo "Sẽ cài: Ollama, giọng đọc, Whisper, vẽ ảnh SDXL-Turbo, sửa khuôn mặt, máy vẽ tay"
else
  echo "RAM ${RAM_GB} GB không đủ để vẽ ảnh (SDXL-Turbo cần khoảng 7 GB riêng): không tải model ảnh, máy chính vẫn tự làm phần ảnh. Đặt NODE_IMAGE=yes để ép cài."
fi

say "2/7 Công cụ hệ thống"
if [ "$DRY" != "1" ]; then
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
  command -v brew >/dev/null 2>&1 || fail "Chưa có Homebrew. Cài từ https://brew.sh rồi chạy lại lệnh này"
  for formula in python@3.12 ffmpeg whisper-cpp ollama; do
    brew list --formula "$formula" >/dev/null 2>&1 || brew install "$formula"
  done
  command -v git >/dev/null 2>&1 || fail "Chưa có git: chạy 'xcode-select --install' rồi chạy lại lệnh này"
  [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ] || command -v tailscale >/dev/null 2>&1 || fail "Chưa cài Tailscale. Cài và đăng nhập cùng tài khoản với Mac mini rồi chạy lại lệnh này"
fi

say "3/7 Tải mã nguồn và công cụ từ Mac mini"
mkdir -p "$REPO" "$LOCAL_AI/bin" "$LOCAL_AI/output" "$REPO/tmp/local-services"
if [ "$DRY" = "1" ]; then echo "[dry-run] curl $BUNDLE/repo.tar.gz | tar -xz -C $REPO"; else curl -fsS "$BUNDLE/repo.tar.gz" | tar -xz -C "$REPO"; fi
TOOLKIT="$REPO/local-tools/toolkit"
[ "$DRY" = "1" ] && TOOLKIT="${AIR_NODE_TOOLKIT:-$TOOLKIT}"
cp "$TOOLKIT"/bin/*.sh "$LOCAL_AI/bin/"
cp "$TOOLKIT"/vieneu_api.py "$TOOLKIT"/vieneu_tts.py "$TOOLKIT"/tts_api.py "$LOCAL_AI/"
chmod +x "$LOCAL_AI"/bin/*.sh

say "4/7 Môi trường Python (vài phút)"
if [ ! -x "$LOCAL_AI/venv/bin/python" ]; then run /opt/homebrew/bin/python3.12 -m venv "$LOCAL_AI/venv"; fi
if [ ! -x "$LOCAL_AI/wb-venv/bin/python" ]; then run /opt/homebrew/bin/python3.12 -m venv "$LOCAL_AI/wb-venv"; fi
run "$LOCAL_AI/venv/bin/pip" install --quiet --disable-pip-version-check -r "$TOOLKIT/requirements-venv.txt"
run "$LOCAL_AI/wb-venv/bin/pip" install --quiet --disable-pip-version-check -r "$TOOLKIT/requirements-wb.txt"
if [ "$WITH_IMAGE" = "yes" ] && [ ! -d "$LOCAL_AI/mlx-examples/.git" ]; then
  run git clone --quiet https://github.com/ml-explore/mlx-examples.git "$LOCAL_AI/mlx-examples"
  run git -C "$LOCAL_AI/mlx-examples" checkout --quiet "$(cat "$TOOLKIT/MLX_EXAMPLES_COMMIT")"
fi

say "5/7 Tải model từ Mac mini (khoảng $([ "$WITH_IMAGE" = "yes" ] && echo 7 || echo 0.5) GB qua mạng nội bộ)"
if [ "$DRY" = "1" ]; then
  echo "[dry-run] curl $BUNDLE/models.tar?image=$WITH_IMAGE | tar -x -C $LOCAL_AI"
else
  curl -fS "$BUNDLE/models.tar?image=$([ "$WITH_IMAGE" = "yes" ] && echo 1 || echo 0)" | tar -x -C "$LOCAL_AI"
fi

say "6/7 Mã truy cập và model Ollama"
TOKEN_FILE="$HOME_DIR/.studio-node-token"
( umask 077; printf '%s' "$TOKEN" > "$TOKEN_FILE" )
echo "Đã lưu mã truy cập vào ~/.studio-node-token (chỉ bạn đọc được); Mac mini đã có cùng mã."
if [ "$DRY" = "1" ]; then
  echo "[dry-run] ollama pull $OLLAMA_MODEL"
else
  if ! curl -fsS -m 3 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    nohup ollama serve >/dev/null 2>&1 &
    OLLAMA_PID=$!
    for _ in $(seq 1 30); do curl -fsS -m 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break; sleep 1; done
  fi
  ollama pull "$OLLAMA_MODEL"
  # Mo-May-Phu.command starts its own Ollama on the Tailscale address, so the temporary one must be gone.
  [ -n "${OLLAMA_PID:-}" ] && kill "$OLLAMA_PID" 2>/dev/null || true
  sleep 2
fi

say "7/7 Bật máy phụ"
if [ "$DRY" = "1" ]; then
  echo "[dry-run] zsh $REPO/scripts/Mo-May-Phu.command"
else
  ( cd "$REPO" && NODE_NAME="$NAME" zsh scripts/Mo-May-Phu.command )
  TS_CLI="$(command -v tailscale || echo /Applications/Tailscale.app/Contents/MacOS/Tailscale)"
  NODE_HOST="$("$TS_CLI" ip -4 2>/dev/null | head -1)"
  for _ in $(seq 1 60); do
    curl -fsS -m 3 -H "Authorization: Bearer $TOKEN" "http://$NODE_HOST:8765/health" >/dev/null 2>&1 && READY=1 && break
    sleep 2
  done
  [ "${READY:-0}" = "1" ] || fail "Media bridge chưa trả lời. Xem $REPO/tmp/local-services/media.log"
  curl -fsS -m 5 -X POST "$BUNDLE/done?name=$NAME&host=$NODE_HOST" >/dev/null 2>&1 || true
fi

cat <<EOF

Xong. Máy '$NAME' đã chạy làm máy phụ (mô hình ảnh cần vài phút để nạp lần đầu).
- Nếu macOS hỏi "Cho phép python/ollama nhận kết nối đến?", chọn Cho phép.
- Giữ máy cắm sạc và mở nắp. Khi cần dùng máy cho việc khác: bash $REPO/scripts/Mo-May-Phu.command pause
- Sau khi khởi động lại máy, chạy lại: bash $REPO/scripts/Mo-May-Phu.command
- Trên Mac mini, trang Cài đặt → "Máy cùng xử lý video" sẽ báo máy này sẵn sàng.
EOF
