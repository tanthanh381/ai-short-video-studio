#!/bin/bash
# Stops this Mac's services as the second machine (the ones scripts/Mo-May-Phu.command started) and forgets the access token.
# The code and models stay unless you pass --purge. Plain "pause" (scripts/Mo-May-Phu.command pause) is enough to keep the Air for yourself.
set -euo pipefail
HOME_DIR="${AIR_NODE_HOME:-$HOME}"
DRY="${AIR_NODE_DRY_RUN:-0}"
REPO="$HOME_DIR/Developer/ai-short-video-studio"
LOCAL_AI="$HOME_DIR/Developer/local-ai"
if [ "$DRY" != "1" ]; then
  for pattern in "$REPO/local-tools/media_server.py" "$REPO/local-tools/image_server.py" "$REPO/local-tools/whiteboard_server.py" \
                 "$LOCAL_AI/bin/start-" "vieneu_api:app" "tts_api:app" "whisper-server" "caffeinate -is"; do
    pkill -f "$pattern" 2>/dev/null || true
  done
fi
rm -f "$HOME_DIR/.studio-node-token" "$HOME_DIR/.studio-node-paused"
echo "đã dừng các dịch vụ máy phụ và xóa mã truy cập"
if [ "${1:-}" = "--purge" ]; then
  rm -rf "$LOCAL_AI" "$REPO"
  echo "đã xóa model và mã nguồn"
fi
