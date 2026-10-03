# Kiến trúc triển khai

```text
GitHub Pages (React)
       │ JWT người dùng
       ▼
Cloudflare Tunnel ── API Express trong Docker ── Supabase Auth/Postgres/Storage
                              │                              ▲
                              │ job bền vững                 │ media + trạng thái
                              ▼                              │
                       Worker Docker + FFmpeg
                              │
                              ├── Claude hoặc OpenAI: storyboard
                              └── OpenAI: ảnh, giọng đọc, timestamp phụ đề
```

## Quyết định chính

- Frontend tĩnh đặt trên GitHub Pages đúng yêu cầu. Router có `404.html` để mở trực tiếp URL con không lỗi.
- Supabase gom đăng nhập, PostgreSQL và object storage. Bucket media là private; API chỉ cấp URL có thời hạn sau khi kiểm tra quyền.
- API và worker tách riêng. API không giữ request trong suốt thời gian render.
- API và worker chạy thành hai container trên máy cá nhân/NAS/VPS. Cloudflare Tunnel mở HTTPS bằng kết nối outbound, không cần mở cổng router.
- Worker có FFmpeg và font Noto Sans, lấy job bằng `FOR UPDATE SKIP LOCKED`. Job có heartbeat, retry giới hạn và được khôi phục nếu worker bị gián đoạn.
- Mỗi cảnh lưu media độc lập. Cảnh đã thành công không bị tạo lại khi cảnh khác lỗi.
- Phụ đề dùng timestamp từ transcription audio thật (`whisper-1`, mức từ), sau đó mới cập nhật timeline.

## Vì sao không render trên GitHub Actions hoặc Cloudflare Workers

GitHub Actions là hệ thống CI/CD, không phải hàng đợi render cho người dùng. Cloudflare Workers có giới hạn CPU theo request và không phải môi trường FFmpeg dài. Worker Docker trên máy do chủ dự án kiểm soát có CPU, file tạm và tiến trình nền cần thiết mà không phát sinh phí nền tảng render riêng.

Phương án này không có phí thuê Railway, nhưng không thể gọi là “miễn phí và không giới hạn”: máy phải luôn bật, dùng điện/băng thông; Supabase, Cloudflare và API AI vẫn có hạn mức hoặc phí theo chính sách của từng dịch vụ.

## An toàn dữ liệu

- API kiểm tra JWT và bảng `allowed_users` cho mọi endpoint `/v1`.
- RLS bật trên toàn bộ bảng public; policy luôn kèm điều kiện chủ sở hữu.
- Supabase secret chỉ cấp cho API/worker; khóa Claude và OpenAI chỉ cấp cho worker. Frontend và repository không chứa secret.
- Log loại bỏ Authorization, token, password và cookie.
- File bị giới hạn MIME, dung lượng và đường dẫn theo `user/project`.
- Job dùng idempotency key, giới hạn đồng thời và ngân sách ngày.
- Thư mục render tạm bị xóa ngay sau khi upload. Media dự án bị xóa theo quy trình xóa dự án.
