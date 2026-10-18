#!/bin/bash
# Stops this Mac's services as the second machine (the ones scripts/Mo-May-Phu.command started) and forgets the access token.
# The code and models stay unless you pass --purge. Plain "pause" (scripts/Mo-May-Phu.command pause) is enough to keep the Air for yourself.
set -euo pipefail
HOME_DIR="${AIR_NODE_HOME:-$HOME}"
DRY="${AIR_NODE_DRY_RUN:-0}"
REPO="$HOME_DIR/Developer/ai-short-video-studio"
LOCAL_AI="$HOME_DIR/Developer/local-ai"
if [ "$DRY" != "1" ]; then
  for pattern in "local-tools/media_server.py" "local-tools/image_server.py" "local-tools/whiteboard_server.py" \
                 "$LOCAL_AI/bin/start-" "vieneu_api:app" "whisper-server" "caffeinate -is"; do
    pkill -f "$pattern" 2>/dev/null || true
  done
fi
if [ "$DRY" != "1" ]; then
  launchctl bootout "gui/$(id -u)/com.ai-short-video.sync" >/dev/null 2>&1 || true
  pkill -f "local-tools/node_sync_agent.py" 2>/dev/null || true
fi
rm -f "$HOME_DIR/Library/LaunchAgents/com.ai-short-video.sync.plist" "$HOME_DIR/.studio-sync.json" "$HOME_DIR/.studio-sync-state.json" "$HOME_DIR/.studio-sync-paused" "$HOME_DIR/.studio-sync-now"
rm -f "$HOME_DIR/.studio-node-token" "$HOME_DIR/.studio-node-paused"
echo "đã dừng các dịch vụ máy phụ và xóa mã truy cập"
if [ "${1:-}" = "--purge" ]; then
  rm -rf "$LOCAL_AI" "$REPO"
  echo "đã xóa model và mã nguồn"
fi
