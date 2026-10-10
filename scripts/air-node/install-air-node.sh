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

# Everything below sits in main() and is called at the very end with stdin closed. Run as `curl … | bash`, bash reads this file from
# the pipe as it goes, and brew, pip or curl inside the script read the same pipe: the first run on the Air lost steps 3-7 to
# `brew install ollama`. Parsing the whole function first and giving every command an empty stdin avoids that.

BUNDLE="@@BUNDLE_URL@@"
TOKEN="@@NODE_TOKEN@@"
NAME="@@NODE_NAME@@"
HOME_DIR="${AIR_NODE_HOME:-$HOME}"
DRY="${AIR_NODE_DRY_RUN:-0}"
REPO="$HOME_DIR/Developer/ai-short-video-studio"
LOCAL_AI="$HOME_DIR/Developer/local-ai"
OLLAMA_MODEL="${OLLAMA_MODEL:-qwen3.5:4b}"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
run() { if [ "$DRY" = "1" ]; then echo "[dry-run] $*"; else "$@"; fi; }
LAST_ERROR=""
CURRENT=""
fail() { LAST_ERROR="$*"; printf '\n\033[31mLỗi: %s\033[0m\n' "$*" >&2; exit 1; }

# The website's Settings page shows these steps while the Air installs. Reporting is best effort and never stops the install.
REPORT="${AIR_NODE_REPORT:-$([ "$DRY" = "1" ] && echo 0 || echo 1)}"
progress() { # step state detail
  [ "$REPORT" = "1" ] || return 0
  curl -fsS -m 4 -G -X POST "$BUNDLE/progress" --data-urlencode "step=$1" --data-urlencode "state=$2" --data-urlencode "detail=${3:-}" >/dev/null 2>&1 || true
}
step() { CURRENT="$1"; progress "$1" running "${3:-}"; say "$2"; } # id, title, detail
on_exit() {
  local code=$?
  if [ "$code" -ne 0 ] && [ -n "$CURRENT" ]; then progress "$CURRENT" failed "${LAST_ERROR:-Script dừng với mã $code ở bước này}"; fi
}
trap on_exit EXIT

main() {
  step check "1/7 Kiểm tra máy"
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

  step tools "2/7 Công cụ hệ thống" "Cài Python, FFmpeg, Whisper, Ollama nếu còn thiếu"
  [ -z "${AIR_NODE_TEST_READ_STDIN:-}" ] || cat >/dev/null  # test only: what brew did to the first run
  if [ "$DRY" != "1" ]; then
    export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
    command -v brew >/dev/null 2>&1 || fail "Chưa có Homebrew. Cài từ https://brew.sh rồi chạy lại lệnh này"
    for formula in python@3.12 ffmpeg whisper-cpp ollama; do
      brew list --formula "$formula" >/dev/null 2>&1 || brew install "$formula"
    done
    command -v git >/dev/null 2>&1 || fail "Chưa có git: chạy 'xcode-select --install' rồi chạy lại lệnh này"
    [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ] || command -v tailscale >/dev/null 2>&1 || fail "Chưa cài Tailscale. Cài và đăng nhập cùng tài khoản với Mac mini rồi chạy lại lệnh này"
  fi

  step code "3/7 Tải mã nguồn và công cụ từ Mac mini"
  mkdir -p "$REPO" "$LOCAL_AI/bin" "$LOCAL_AI/output" "$REPO/tmp/local-services"
  if [ "$DRY" = "1" ]; then echo "[dry-run] curl $BUNDLE/repo.tar.gz | tar -xz -C $REPO"; else curl -fsS "$BUNDLE/repo.tar.gz" | tar -xz -C "$REPO"; fi
  TOOLKIT="$REPO/local-tools/toolkit"
  [ "$DRY" = "1" ] && TOOLKIT="${AIR_NODE_TOOLKIT:-$TOOLKIT}"
  cp "$TOOLKIT"/bin/*.sh "$LOCAL_AI/bin/"
  cp "$TOOLKIT"/vieneu_api.py "$TOOLKIT"/vieneu_tts.py "$TOOLKIT"/tts_api.py "$LOCAL_AI/"
  chmod +x "$LOCAL_AI"/bin/*.sh

  step python "4/7 Môi trường Python (vài phút)" "Dựng môi trường Python cho giọng đọc và vẽ ảnh"
  if [ ! -x "$LOCAL_AI/venv/bin/python" ]; then run /opt/homebrew/bin/python3.12 -m venv "$LOCAL_AI/venv"; fi
  if [ ! -x "$LOCAL_AI/wb-venv/bin/python" ]; then run /opt/homebrew/bin/python3.12 -m venv "$LOCAL_AI/wb-venv"; fi
  run "$LOCAL_AI/venv/bin/pip" install --quiet --disable-pip-version-check -r "$TOOLKIT/requirements-venv.txt"
  progress python running "Cài thư viện cho sửa khuôn mặt và máy vẽ tay"
  run "$LOCAL_AI/wb-venv/bin/pip" install --quiet --disable-pip-version-check -r "$TOOLKIT/requirements-wb.txt"
  if [ "$WITH_IMAGE" = "yes" ] && [ ! -d "$LOCAL_AI/mlx-examples/.git" ]; then
    run git clone --quiet https://github.com/ml-explore/mlx-examples.git "$LOCAL_AI/mlx-examples"
    run git -C "$LOCAL_AI/mlx-examples" checkout --quiet "$(cat "$TOOLKIT/MLX_EXAMPLES_COMMIT")"
  fi

  step models "5/7 Tải model từ Mac mini (khoảng $([ "$WITH_IMAGE" = "yes" ] && echo 7 || echo 0.5) GB qua mạng nội bộ)"
  # A second run must not fetch 7 GB again: models are skipped when they are all there (the picture model by the size of its
  # biggest file, which a download cut short would not reach) or when the last run marked them complete.
  MODELS_DONE="$LOCAL_AI/models/.air-models-complete-$WITH_IMAGE"
  UNET=$(ls "$LOCAL_AI"/models/image/hf-cache/hub/models--stabilityai--sdxl-turbo/snapshots/*/unet/diffusion_pytorch_model.safetensors 2>/dev/null | head -1 || true)
  UNET_BYTES=0; [ -n "$UNET" ] && UNET_BYTES=$(stat -L -f %z "$UNET" 2>/dev/null || stat -L -c %s "$UNET" 2>/dev/null || echo 0)
  SMALL_OK=0; [ -e "$LOCAL_AI/models/whisper/ggml-base.bin" ] && [ -d "$LOCAL_AI/models/piper" ] && [ -d "$LOCAL_AI/models/vieneu-v3-turbo" ] && SMALL_OK=1
  IMAGE_OK=1; [ "$WITH_IMAGE" = "yes" ] && [ "$UNET_BYTES" -lt "${AIR_NODE_MIN_UNET_BYTES:-5000000000}" ] && IMAGE_OK=0
  if [ -f "$MODELS_DONE" ] || { [ "$SMALL_OK" = "1" ] && [ "$IMAGE_OK" = "1" ]; }; then
    echo "Model đã có đủ trên máy này, bỏ qua bước tải (muốn tải lại: xóa $LOCAL_AI/models)"
    progress models done "Model đã có sẵn, không cần tải lại"
  elif [ "$DRY" = "1" ]; then
    echo "[dry-run] curl $BUNDLE/models.tar?image=$WITH_IMAGE | tar -x -C $LOCAL_AI"
  else
    curl -fS "$BUNDLE/models.tar?image=$([ "$WITH_IMAGE" = "yes" ] && echo 1 || echo 0)" | tar -x -C "$LOCAL_AI"
    : > "$MODELS_DONE"
  fi

  step token "6/7 Mã truy cập và model Ollama" "Lưu mã truy cập và kéo model $OLLAMA_MODEL"
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

  step start "7/7 Bật máy phụ" "Bật Ollama, Whisper, giọng đọc, vẽ ảnh, máy vẽ tay"
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

  echo
  echo "Xong. Máy '$NAME' đã chạy làm máy phụ (mô hình ảnh cần vài phút để nạp lần đầu)."
  echo "- Nếu macOS hỏi \"Cho phép python/ollama nhận kết nối đến?\", chọn Cho phép."
  echo "- Giữ máy cắm sạc và mở nắp. Khi cần dùng máy cho việc khác: bash $REPO/scripts/Mo-May-Phu.command pause"
  echo "- Sau khi khởi động lại máy, chạy lại: bash $REPO/scripts/Mo-May-Phu.command"
  echo "- Trên Mac mini, trang Cài đặt → \"Máy cùng xử lý video\" sẽ báo máy này sẵn sàng."
}

main "$@" </dev/null
