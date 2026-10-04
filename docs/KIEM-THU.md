# Biên bản kiểm thử

Ngày lập: 02/10/2026. Cập nhật QC: 04/10/2026.

| Hạng mục                                                 | Cách kiểm tra                                           | Trạng thái                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------- |
| TypeScript toàn monorepo                                 | `pnpm typecheck`                                        | Đạt ngày 02/10/2026                                                        |
| Unit test schema, API auth, CORS, routing, provider, timestamp, render validation | `pnpm test`                                             | Đạt: 17/17 test ngày 04/10/2026                                            |
| Build React production                                   | `pnpm build`                                            | Đạt; bundle JS 331,89 kB (gzip 102,25 kB)                                  |
| Frontend không chứa secret                               | quét source và bundle + kiểm tra CI                     | Đạt local và GitHub Actions                                                 |
| Đăng nhập và chặn người ngoài                            | Supabase Auth + API 401/403/200 + `allowed_users`        | Đạt với phiên Supabase thật; đã sửa và xác minh quyền `service_role`       |
| Tạo/sửa/lưu dự án                                        | chế độ 0 đồng API + API thật                            | Giao diện đã bật chế độ backend thật; cần đăng nhập để kiểm chứng thao tác production |
| Upload ảnh/audio                                         | signed upload, MIME và size check                       | Code đã hỗ trợ media thủ công; chưa chạy upload production trong phiên này  |
| AI storyboard                                            | Claude/OpenAI adapters                                  | Chưa gọi API thật vì chưa có key/ngân sách                                 |
| AI ảnh/TTS/timestamp                                     | OpenAI adapter                                          | Chưa gọi API thật vì chưa có key/ngân sách                                 |
| Render MP4 FFmpeg                                        | smoke test trong container + `ffprobe`                  | Đạt: 4,10 giây, 1080 × 1920, H.264 + AAC, có nhạc nền                      |
| Phụ đề tiếng Việt                                        | burn-in ASS + font Noto trong container                 | Đạt; thumbnail thật hiển thị đúng “Xin chào Việt Nam”                      |
| Tải lại khi job chạy                                     | job PostgreSQL + polling                                | Chưa kiểm chứng production                                                 |
| Thử lại job lỗi                                          | API retry, nút UI và giới hạn số lần                    | Code hoàn tất; chưa kiểm chứng production                                  |
| Mobile                                                   | viewport 390 × 844, kiểm tra DOM và ảnh chụp            | Đạt; preview, storyboard và thiết lập cùng truy cập được; không tràn ngang |
| GitHub Pages                                             | workflow Pages + mở URL public và URL con `/media`      | Đạt ngày 03/10/2026; routing trực tiếp không lỗi                            |

Lệnh nghiệm thu cuối `pnpm check` chạy thành công ngày 04/10/2026: typecheck, 17 unit test và production build. GitHub Actions CI và workflow GitHub Pages cho các commit trước đều chạy thành công; trang Cài đặt public đã hiển thị riêng trạng thái Claude, ChatGPT/OpenAI và FFmpeg tự host.

Không đánh dấu luồng AI là “đã kiểm chứng” cho đến khi gọi dịch vụ thật. API và worker hiện chạy bằng Docker/Colima trên máy tự host; render lõi cùng burn-in phụ đề tiếng Việt đã được kiểm tra bằng MP4 thật trong container. Chế độ 0 đồng API không gọi OpenAI/Claude, chỉ dùng storyboard và media người dùng tải lên. Supabase project riêng, schema, RLS, bucket, Auth user và allowlist đã được tạo và kiểm tra qua API. Cloudflare Tunnel, Claude key và OpenAI key không cần cho chế độ này.
