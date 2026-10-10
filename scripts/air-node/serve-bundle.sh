#!/bin/bash
# Run on the Mac mini. Prepares the MacBook Air to join as the second machine and prints the one line to paste into Terminal on the Air.
#   bash scripts/air-node/serve-bundle.sh [name]      (name defaults to "air": the Tailscale machine name of the Air)
# 1. makes sure .env.selfhost has AI_NODES (the Air's Tailscale address) and AI_NODES_TOKEN (generated here, never printed, and sent
#    to the Air by the installer, so nothing has to be copied by hand);
# 2. serves the installer, the committed code and the models to the Air only, over Tailscale, for 90 minutes or until the Air reports in.
# Then the worker needs a restart to read the new list (check the job queue first).
set -euo pipefail
cd "$(dirname "$0")/../.."
NAME="${1:-air}"
ENV_FILE="${ENV_FILE:-.env.selfhost}"
LOCAL_AI="${LOCAL_AI_ROOT:-$HOME/Developer/local-ai}"
TS="$(command -v tailscale || true)"
[ -n "$TS" ] || [ ! -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ] || TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale
[ -n "$TS" ] || { echo "Không tìm thấy lệnh tailscale"; exit 1; }
MY_IP="$("$TS" ip -4 | head -1)"
AIR_IP="$("$TS" status --json | python3 -c "
import json,sys
name = sys.argv[1].lower()
for peer in (json.load(sys.stdin).get('Peer') or {}).values():
    if peer.get('HostName', '').lower() == name:
        print(peer['TailscaleIPs'][0]); break
" "$NAME")"
[ -n "$AIR_IP" ] || { echo "Tailscale không thấy máy tên '$NAME'. Kiểm tra tên máy trong 'tailscale status'."; exit 1; }
python3 - "$ENV_FILE" "$NAME" "$AIR_IP" <<'PY'
import os, secrets, sys
path, name, ip = sys.argv[1:4]
sys.path.insert(0, "local-tools")
import air_bundle_server as bundle
text = open(path).read() if os.path.exists(path) else ""
token = bundle.env_value(text, "AI_NODES_TOKEN") or secrets.token_hex(24)

def put(text, key, value):
    lines, done = text.splitlines(), False
    for index, line in enumerate(lines):
        if line.startswith(f"{key}="):
            lines[index], done = f"{key}={value}", True
    if not done:
        lines.append(f"{key}={value}")
    return "\n".join(lines) + "\n"

nodes = bundle.env_value(text, "AI_NODES")
entries = [entry for entry in nodes.split(",") if entry and not entry.startswith(f"{name}=")]
text = put(text, "AI_NODES", ",".join(entries + [f"{name}={ip}"]))
text = put(text, "AI_NODES_TOKEN", token)
with open(path, "w") as handle:
    handle.write(text)
os.chmod(path, 0o600)
print(f"Đã ghi AI_NODES và AI_NODES_TOKEN vào {path} (mã truy cập tự sinh, không in ra).")
PY
TOKEN="$(python3 - "$ENV_FILE" <<'PY'
import sys
sys.path.insert(0, "local-tools")
import air_bundle_server as b
print(b.env_value(open(sys.argv[1]).read(), "AI_NODES_TOKEN"))
PY
)"
[ -n "$TOKEN" ] || { echo "Không đọc được AI_NODES_TOKEN trong $ENV_FILE"; exit 1; }
SECRET="$(openssl rand -hex 12)"
echo
echo "Trên máy $NAME, mở Terminal và dán đúng một dòng (hết hạn sau 90 phút hoặc khi cài xong):"
exec python3 local-tools/air_bundle_server.py --repo "$PWD" --local-ai "$LOCAL_AI" --host "$MY_IP" --secret "$SECRET" --token "$TOKEN" --name "$NAME" --port "${BUNDLE_PORT:-8899}"
