#!/bin/zsh
# Cập nhật MÁY CHÍNH (Mac mini) lên bản mới nhất: tải mã mới, dựng lại API và worker, khởi động lại các dịch vụ AI,
# rồi tự kiểm tra. Chỉ cần nhấp đúp tệp này. Dữ liệu và video đã tạo không bị đụng tới.
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
self=${0:A}
studio_root=${self:h:h}
cd "$studio_root"

done_and_wait() { print ''; read -k 1 '?Nhấn phím bất kỳ để đóng cửa sổ này...'; print ''; }
fail() { print ''; print "LỖI: $1"; print 'Hãy chụp màn hình cửa sổ này và gửi cho người hỗ trợ.'; done_and_wait; exit 1; }

if [[ "${1:-}" != "--da-tai" ]]; then
  [[ -f .env.selfhost ]] || fail "Không thấy tệp cấu hình .env.selfhost trong $studio_root. Đây có đúng là thư mục dự án trên máy chính không?"
  print 'Việc này sẽ khởi động lại các dịch vụ AI trên máy này (mất khoảng vài phút).'
  print 'Nếu đang có video được tạo, hãy đợi video đó xong rồi mới chạy.'
  read -q '?Hiện KHÔNG có video nào đang tạo? (nhấn y để tiếp tục, phím khác để hủy) ' || { print ''; print 'Đã hủy, chưa thay đổi gì.'; done_and_wait; exit 0; }
  print ''
  print '1/5 Tải bản mới từ GitHub...'
  before=$(git rev-parse --short HEAD)
  git pull --ff-only origin main || fail 'Không tải được bản mới. Có thể thư mục dự án đang có chỉnh sửa tay, hoặc máy chưa kết nối Internet.'
  print "    $before -> $(git rev-parse --short HEAD)"
  # Tệp này có thể vừa được thay bằng bản mới: chạy lại chính nó từ đầu để không đọc dở một tệp đã đổi.
  exec "$self" --da-tai
fi

print '2/5 Bật Docker nếu chưa bật...'
if ! docker info >/dev/null 2>&1; then
  colima start || fail 'Không bật được Docker (colima).'
fi

print '3/5 Dựng lại API và worker (lần đầu có thể mất vài phút)...'
docker-compose --env-file .env.selfhost -f docker-compose.selfhost.yml up -d --build api worker || fail 'Dựng lại API và worker bị lỗi.'

print '4/5 Khởi động lại máy vẽ ảnh và cầu nối media để nạp mã mới...'
restart_port() { # cổng tên
  local pids
  pids=$(lsof -ti "tcp:$1" -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    print "    dừng $2 (cổng $1)"
    kill ${=pids} 2>/dev/null || true
    sleep 2
  fi
}
restart_port 8765 'cầu nối media'
restart_port 5002 'máy vẽ ảnh'
# Bật lại những gì đang tắt (và mở website); các dịch vụ khác đang chạy thì giữ nguyên.
"$studio_root/scripts/Mo-Video-Studio.command" || fail 'Không bật lại được các dịch vụ AI.'

print '5/5 Kiểm tra...'
for _ in {1..60}; do
  curl -fsS http://127.0.0.1:8765/node-status >/dev/null 2>&1 && break
  sleep 2
done
api_ok=no; bridge_ok=no; image_state=?
curl -fsS http://127.0.0.1:8787/health 2>/dev/null | grep -q '"ok":true' && api_ok=yes
node_json=$(curl -fsS http://127.0.0.1:8765/node-status 2>/dev/null || true)
if [[ -n "$node_json" ]]; then
  bridge_ok=yes
  image_state=$(print -- "$node_json" | /opt/homebrew/bin/python3.12 -c 'import json,sys; print(json.load(sys.stdin).get("image",{}).get("state","?"))' 2>/dev/null || print '?')
fi
print ''
print "  API:                 $([[ $api_ok == yes ]] && print 'hoạt động' || print 'CHƯA phản hồi')"
print "  Cầu nối media:       $([[ $bridge_ok == yes ]] && print 'đã chạy bản mới' || print 'CHƯA phản hồi (thử mở lại tệp này sau 1-2 phút)')"
case "$image_state" in
  ready)   print '  Máy vẽ ảnh:          sẵn sàng' ;;
  loading) print '  Máy vẽ ảnh:          đang nạp model, khoảng vài phút nữa là xong' ;;
  *)       print "  Máy vẽ ảnh:          $image_state" ;;
esac
print ''
if [[ $api_ok == yes && $bridge_ok == yes ]]; then
  print 'XONG. Máy chính đã cập nhật. Hệ thống vẫn chạy như cũ cho tới khi bạn nối thêm máy phụ.'
else
  print 'Chưa xong hoàn toàn: có phần chưa phản hồi. Chờ 1-2 phút rồi nhấp đúp lại tệp này; nếu vẫn vậy, chụp màn hình gửi cho người hỗ trợ.'
fi
done_and_wait
