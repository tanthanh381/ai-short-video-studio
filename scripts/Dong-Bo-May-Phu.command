#!/bin/zsh
# Chạy trên MÁY PHỤ (MacBook Air): xem hoặc điều khiển việc tự đồng bộ với Mac mini.
#   scripts/Dong-Bo-May-Phu.command status    xem lần đồng bộ gần nhất
#   scripts/Dong-Bo-May-Phu.command now       đồng bộ ngay (không đợi phút kế tiếp)
#   scripts/Dong-Bo-May-Phu.command pause     tạm dừng tự đồng bộ
#   scripts/Dong-Bo-May-Phu.command resume    bật lại
#   scripts/Dong-Bo-May-Phu.command once      chạy một vòng ngay trong cửa sổ này và in kết quả
set -euo pipefail
studio_root=${0:A:h:h}
py=/opt/homebrew/bin/python3.12; [[ -x $py ]] || py=$(command -v python3)
exec "$py" "$studio_root/local-tools/node_sync_agent.py" "${1:-status}"
