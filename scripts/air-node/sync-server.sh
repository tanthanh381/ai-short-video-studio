#!/bin/bash
# Mac mini: the server the second machine's sync agent copies from (local-tools/node_sync_server.py), kept running by launchd.
#   scripts/air-node/sync-server.sh install     writes the LaunchAgent and starts it (safe to repeat)
#   scripts/air-node/sync-server.sh status      is it up, and what does it offer
#   scripts/air-node/sync-server.sh restart
#   scripts/air-node/sync-server.sh uninstall
# It listens on the Tailscale address only and asks for the access code (AI_NODES_TOKEN in .env.selfhost, never printed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL="com.ai-short-video.sync-server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PORT="${SYNC_PORT:-8898}"
LOCAL_AI="${LOCAL_AI_ROOT:-$HOME/Developer/local-ai}"
PY="/opt/homebrew/bin/python3.12"; [ -x "$PY" ] || PY="$(command -v python3)"
DOMAIN="gui/$(id -u)"

case "${1:-status}" in
  install)
    grep -q '^AI_NODES_TOKEN=.\+' "$ROOT/.env.selfhost" || { echo "Chưa có AI_NODES_TOKEN trong .env.selfhost: chạy scripts/air-node/serve-bundle.sh một lần để tạo."; exit 1; }
    mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/tmp/local-services"
    {
      echo '<?xml version="1.0" encoding="UTF-8"?>'
      echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
      echo '<plist version="1.0"><dict>'
      echo "<key>Label</key><string>$LABEL</string>"
      echo "<key>ProgramArguments</key><array><string>$PY</string><string>$ROOT/local-tools/node_sync_server.py</string><string>--repo</string><string>$ROOT</string><string>--local-ai</string><string>$LOCAL_AI</string><string>--port</string><string>$PORT</string><string>--env-file</string><string>$ROOT/.env.selfhost</string></array>"
      echo "<key>WorkingDirectory</key><string>$ROOT</string>"
      echo '<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>'
      echo "<key>StandardOutPath</key><string>$ROOT/tmp/local-services/sync-server.log</string>"
      echo "<key>StandardErrorPath</key><string>$ROOT/tmp/local-services/sync-server.log</string>"
      echo '</dict></plist>'
    } > "$PLIST"
    chmod 600 "$PLIST"
    launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    launchctl kickstart -k "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
    echo "Đã bật máy chủ đồng bộ (cổng $PORT, chỉ nghe ở địa chỉ Tailscale). Xem trạng thái: $0 status"
    ;;
  restart)
    launchctl kickstart -k "$DOMAIN/$LABEL"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
    rm -f "$PLIST"
    echo "Đã gỡ máy chủ đồng bộ."
    ;;
  status)
    launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || { echo "Máy chủ đồng bộ chưa chạy. Bật: $0 install"; exit 1; }
    PY="$PY" ROOT="$ROOT" PORT="$PORT" "$PY" - <<'PYEOF'
import json, os, subprocess, sys, urllib.request
sys.path.insert(0, os.path.join(os.environ["ROOT"], "local-tools"))
import node_sync_server as server
token = server.env_value(open(os.path.join(os.environ["ROOT"], ".env.selfhost")).read(), "AI_NODES_TOKEN")
host = server.find_tailscale()
request = urllib.request.Request(f"http://{host}:{os.environ['PORT']}/manifest?brief=1", headers={"Authorization": f"Bearer {token}"})
brief = json.load(urllib.request.urlopen(request, timeout=10))
print(f"Máy chủ đồng bộ đang chạy tại {host}:{os.environ['PORT']}: phiên bản {brief['version']}, {brief['counts']['files']} tệp, {brief['counts']['bytes'] / 2**30:.1f} GB")
PYEOF
    ;;
  *)
    echo "dùng: $0 [install|status|restart|uninstall]"; exit 1
    ;;
esac
