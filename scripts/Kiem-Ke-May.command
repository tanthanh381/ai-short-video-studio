#!/bin/zsh
# Kiểm kê máy này (chỉ ĐỌC, không thay đổi gì): cấu hình máy, các công cụ đã cài, thư mục model AI và dịch vụ đang chạy.
# Kết quả hiện trên màn hình và được lưu ra Desktop để gửi cho người hỗ trợ. Không in mật khẩu, khóa hay token.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
self=${0:A}
studio_root=${self:h:h}
LOCAL_AI_ROOT=${LOCAL_AI_ROOT:-"$HOME/Developer/local-ai"}
out="$HOME/Desktop/kiem-ke-$(hostname -s).txt"
tailscale_cmd=$(command -v tailscale || true)
[[ -n "$tailscale_cmd" ]] || { [[ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]] && tailscale_cmd=/Applications/Tailscale.app/Contents/MacOS/Tailscale; }

mask() { sed -E 's/((TOKEN|SECRET|KEY|PASSWORD|PASS)[A-Za-z_]*=).*/\1***/'; }
have() { command -v "$1" >/dev/null 2>&1 && print -- "$1: $(command -v "$1")" || print -- "$1: (chưa có)"; }

{
  print "=== MÁY ==="
  print "tên máy: $(hostname -s)    người dùng: $(whoami)    thư mục Home: $HOME"
  print "macOS: $(sw_vers -productVersion 2>/dev/null)    chip: $(sysctl -n machdep.cpu.brand_string 2>/dev/null)"
  print "RAM: $(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1073741824 )) GB    trống ổ đĩa: $(df -h "$HOME" | awk 'NR==2{print $4}')"
  print ""
  print "=== TAILSCALE ==="
  if [[ -n "$tailscale_cmd" ]]; then
    print "địa chỉ: $("$tailscale_cmd" ip -4 2>/dev/null | head -n1)"
    "$tailscale_cmd" status 2>/dev/null | head -n 8
  else
    print "chưa tìm thấy Tailscale"
  fi
  print ""
  print "=== CÔNG CỤ ==="
  for tool in brew git python3.12 ffmpeg ollama docker docker-compose colima node pnpm; do have $tool; done
  print "Đăng nhập từ xa (SSH, cổng 22): $(nc -z -w 2 127.0.0.1 22 >/dev/null 2>&1 && print BẬT || print TẮT)"
  print ""
  print "=== DỰ ÁN ==="
  print "thư mục: $studio_root"
  print "bản mã: $(git -C "$studio_root" rev-parse --short HEAD 2>/dev/null || print '(không phải thư mục git)')"
  if [[ -f "$studio_root/.env.selfhost" ]]; then
    print "các khóa cấu hình trong .env.selfhost (chỉ tên, không in giá trị):"
    grep -E '^(AI_|LOCAL_MEDIA|OLLAMA|COMFYUI|LTX|WORKER|MAX_|RENDER)' "$studio_root/.env.selfhost" | sed -E 's/=.*/=…/' | sort | sed 's/^/  /'
  fi
  print ""
  print "=== THƯ MỤC MODEL AI: $LOCAL_AI_ROOT ==="
  if [[ -d "$LOCAL_AI_ROOT" ]]; then
    du -sh "$LOCAL_AI_ROOT" 2>/dev/null
    du -sh "$LOCAL_AI_ROOT"/* 2>/dev/null | sed 's/^/  /'
    for sub in models bin; do
      [[ -d "$LOCAL_AI_ROOT/$sub" ]] && { print "  -- $sub/"; du -sh "$LOCAL_AI_ROOT/$sub"/* 2>/dev/null | sed 's/^/     /'; }
    done
    for venv in venv wb-venv ltx-venv; do
      py="$LOCAL_AI_ROOT/$venv/bin/python"
      [[ -x "$py" ]] && print "  $venv: $("$py" --version 2>&1), $("$py" -m pip freeze 2>/dev/null | wc -l | tr -d ' ') gói, trỏ tới $(readlink "$py" 2>/dev/null || print "$py")"
    done
    for script in "$LOCAL_AI_ROOT"/bin/start-*.sh(N); do
      print ""
      print "  --- $script ---"
      head -n 40 "$script" | mask | sed 's/^/  | /'
    done
  else
    print "chưa có thư mục này"
  fi
  print ""
  print "=== OLLAMA ==="
  command -v ollama >/dev/null 2>&1 && ollama list 2>/dev/null || print "(không có)"
  print ""
  print "=== DỊCH VỤ ĐANG CHẠY (cổng) ==="
  lsof -iTCP -sTCP:LISTEN -nP 2>/dev/null | awk 'NR==1 || /:(5000|5001|5002|8080|8765|8766|8770|8787|11434)[ ]/' | awk '{print $1, $9}' | sort -u | sed 's/^/  /'
  print ""
  print "=== TỰ KHỞI ĐỘNG (launchd) ==="
  ls "$HOME/Library/LaunchAgents" 2>/dev/null | grep -iE 'ai-short|studio|whiteboard|vieneu|piper|whisper|image|ollama|tailscale' | sed 's/^/  /'
} 2>&1 | tee "$out"

print ""
print "Đã lưu bản kiểm kê vào: $out"
print "Hãy mở tệp đó (hoặc chọn hết nội dung cửa sổ này), sao chép và gửi cho người hỗ trợ."
read -k 1 '?Nhấn phím bất kỳ để đóng cửa sổ này...'; print ''
