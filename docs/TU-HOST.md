# Chạy backend và worker trên máy riêng

Phương án này giữ frontend trên GitHub Pages và chạy API/FFmpeg trên máy cá nhân, mini PC, NAS hoặc VPS có Docker. Tailscale Funnel cấp địa chỉ HTTPS công khai mà không cần mở cổng mạng.

## Chuẩn bị một lần

1. Cài Docker Desktop và bảo đảm máy có thể chạy liên tục khi cần tạo video.
2. Tạo một project Supabase Free riêng cho ứng dụng.
3. Chạy migration trong thư mục `supabase/migrations` theo đúng thứ tự.
4. Tạo tài khoản đăng nhập trong Supabase Authentication và thêm `user_id` đó vào bảng `allowed_users`.
5. Chọn Tailscale Funnel (không cần domain riêng), hoặc chạy frontend trên chính máy backend với `VITE_API_URL=http://localhost:8787`.
6. API key OpenAI và Anthropic là tùy chọn. Có thể để trống cả hai và chạy chế độ local-first bằng Ollama, image server SDXL-Turbo/MLX, VieNeu/Piper hoặc TTS Linh của macOS và whisper.cpp.

## Cấu hình bí mật

Sao chép `.env.selfhost.example` thành `.env.selfhost`, rồi điền các giá trị thật ngay trên máy chạy Docker. Không gửi key qua chat và không commit file này.

```bash
cp .env.selfhost.example .env.selfhost
```

Đặt `ALLOWED_ORIGINS=https://tanthanh381.github.io`. Tailscale Funnel không cần token trong ứng dụng. Với frontend Pages, đặt `VITE_API_URL` trong biến Actions bằng hostname HTTPS public. Có thể để key AI trống khi dùng media local.

## Cài media AI local trên macOS

Máy kiểm thử đã cài Python 3.12, MLX Stable Diffusion với cache SDXL-Turbo và model Whisper trong các thư mục bị `.gitignore`. VieNeu/Piper cung cấp giọng tiếng Việt local. Image server bật anatomy guard + negative prompt để hạn chế mặt, tay và cơ thể biến dạng; dùng `IMAGE_CFG_WEIGHT=0` nếu ưu tiên tốc độ tối đa hơn chất lượng. Đây là phần mềm/model có thể dùng miễn phí; không phát sinh API charge, nhưng thời gian tạo ảnh phụ thuộc phần cứng.

Khởi động các tiến trình local trước khi bật worker Docker:

```bash
export LOCAL_AI_ROOT="$HOME/Developer/local-ai"
"$LOCAL_AI_ROOT/venv/bin/python" local-tools/image_server.py
LOCAL_MEDIA_HOST=127.0.0.1 /opt/homebrew/bin/python3.12 local-tools/media_server.py
# Chỉ bật sau khi có đủ text encoder local:
LTX_VIDEO_TEXT_ENCODER="$HOME/.cache/huggingface/hub/models--PixArt-alpha--PixArt-XL-2-1024-MS/snapshots/<revision>" \
  "$LOCAL_AI_ROOT/ltx-venv/bin/python" local-tools/ltx_server.py
```

Trong `.env.selfhost`:

```dotenv
LOCAL_MEDIA_BASE_URL=http://host.docker.internal:8765
LOCAL_MEDIA_FEATURES_ENABLED=true
LTX_VIDEO_URL=http://127.0.0.1:8770
```

Trong màn hình tạo video, preset ảnh local có ba mức: **Fast** (2 bước SDXL-Turbo, ưu tiên tốc độ), **Balanced** (4 bước, mặc định) và **Quality** (8 bước, ưu tiên chi tiết khuôn mặt/tay). Có thể đặt `IMAGE_PRESET=balanced` làm mặc định cho máy; lựa chọn trong từng dự án được truyền an toàn tới media bridge và không gọi API trả phí.

Cầu nối chỉ bind localhost; worker Docker truy cập qua `host.docker.internal`, không công khai endpoint media.

## Khởi động

```bash
docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml up -d --build
docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml ps
```

Kiểm tra API nội bộ tại `http://127.0.0.1:8787/health`. Sau đó đặt GitHub Actions variable `VITE_API_URL` bằng hostname HTTPS của Tailscale Funnel, hoặc `http://localhost:8787` nếu chạy local, rồi triển khai lại frontend.

Trong **Cài đặt**, nút **Kiểm tra lại** gọi `GET /v1/settings` để kiểm tra Backend API, quyền Supabase, worker render, Ollama và media server. Worker cung cấp health endpoint nội bộ tại `http://worker:8790/health`; không cần publish cổng này ra Internet. OpenAI/Claude chỉ được kiểm tra sự tồn tại của API key, không gọi API provider để tránh phát sinh chi phí. Nếu vừa sửa `.env.selfhost`, hãy rebuild/restart compose trước khi kiểm tra lại.

## Kết nối public bằng Tailscale Funnel

Tailscale Funnel chuyển tiếp riêng cổng API ra HTTPS; worker, ComfyUI và media server vẫn chỉ chạy trên máy local. Trên máy đã đăng nhập Tailscale và đã được quản trị viên cho phép Funnel:

```bash
tailscale up --accept-dns=false --accept-routes
tailscale funnel --bg --https=443 http://127.0.0.1:8787
tailscale funnel status
```

Lấy hostname HTTPS từ `tailscale funnel status`, kiểm tra `/health`, rồi đặt GitHub Actions variable `VITE_API_URL` bằng hostname đó (ví dụ `https://may-cua-ban.tailnet.ts.net`). Máy phải bật Tailscale, Docker API và worker khi sử dụng; nếu máy tắt hoặc Funnel dừng thì frontend vẫn mở được nhưng không tạo/render video.

## Dừng và cập nhật

```bash
docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml stop
git pull
docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml up -d --build
```

Không dùng `down -v` trừ khi chủ động muốn xóa volume file tạm. Media chính nằm trong Supabase Storage, không nằm trong repository.

Khi dừng hoặc dựng lại, worker làm nốt video đang tạo rồi mới thoát (tối đa 45 phút, `stop_grace_period`), nên lệnh có thể chờ lâu nếu đang có video chạy; không nhấn Ctrl+C để ép dừng. Mỗi lần dựng lại để lại image cũ không dùng tới; dọn định kỳ để ổ đĩa không đầy:

```bash
docker image prune -f
colima ssh -- sudo fstrim -a
```
