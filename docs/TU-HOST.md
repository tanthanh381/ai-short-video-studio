# Chạy backend và worker trên máy riêng

Phương án này giữ frontend trên GitHub Pages và chạy API/FFmpeg trên máy cá nhân, mini PC, NAS hoặc VPS có Docker. Cloudflare Tunnel cung cấp địa chỉ HTTPS công khai mà không cần mở cổng mạng.

## Chuẩn bị một lần

1. Cài Docker Desktop và bảo đảm máy có thể chạy liên tục khi cần tạo video.
2. Tạo một project Supabase Free riêng cho ứng dụng.
3. Chạy migration trong thư mục `supabase/migrations` theo đúng thứ tự.
4. Tạo tài khoản đăng nhập trong Supabase Authentication và thêm `user_id` đó vào bảng `allowed_users`.
5. Nếu có domain, tạo Cloudflare Tunnel và gắn một hostname với dịch vụ `http://api:8787`. Nếu chưa có domain, dùng frontend với `VITE_API_URL=http://localhost:8787` để gọi backend local miễn phí.
6. API key OpenAI và Anthropic là tùy chọn. Có thể để trống cả hai và chạy chế độ 0 đồng API bằng media tải lên thủ công.

## Cấu hình bí mật

Sao chép `.env.selfhost.example` thành `.env.selfhost`, rồi điền các giá trị thật ngay trên máy chạy Docker. Không gửi key qua chat và không commit file này.

```bash
cp .env.selfhost.example .env.selfhost
```

Đặt `ALLOWED_ORIGINS=https://tanthanh381.github.io` và điền token Tunnel nếu dùng Tunnel. Nếu chạy backend local cho frontend Pages, vẫn giữ origin GitHub Pages và đặt `VITE_API_URL=http://localhost:8787` trong biến build. Để key AI trống và giữ các cờ AI là `false` để dùng chế độ 0 đồng API.

## Khởi động

```bash
docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml up -d --build
docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml ps
```

Kiểm tra API nội bộ tại `http://127.0.0.1:8787/health`. Sau đó đặt GitHub Actions variable `VITE_API_URL` bằng hostname HTTPS của Tunnel, hoặc `http://localhost:8787` nếu chạy local, rồi triển khai lại frontend.

## Dừng và cập nhật

```bash
docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml stop
git pull
docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml up -d --build
```

Không dùng `down -v` trừ khi chủ động muốn xóa volume file tạm. Media chính nằm trong Supabase Storage, không nằm trong repository.
