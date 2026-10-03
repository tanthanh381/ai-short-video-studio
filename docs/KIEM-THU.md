# Biên bản kiểm thử

Ngày lập: 02/10/2026. Cập nhật triển khai: 03/10/2026.

| Hạng mục                                                 | Cách kiểm tra                                           | Trạng thái                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------- |
| TypeScript toàn monorepo                                 | `pnpm typecheck`                                        | Đạt ngày 02/10/2026                                                        |
| Unit test schema, API auth, routing, provider, timestamp | `pnpm test`                                             | Đạt: 11/11 test ngày 03/10/2026                                            |
| Build React production                                   | `pnpm build`                                            | Đạt; bundle JS 331,35 kB (gzip 102,12 kB)                                  |
| Frontend không chứa secret                               | quét source và bundle + kiểm tra CI                     | Đạt local và GitHub Actions                                                 |
| Đăng nhập và chặn người ngoài                            | test API 401 + middleware `allowed_users`               | Test 401 đạt; chưa kiểm chứng với Supabase thật                            |
| Tạo/sửa/lưu dự án                                        | chế độ mẫu local + API thật                             | Chế độ mẫu đạt; chưa kiểm chứng với Supabase thật                          |
| Upload ảnh/audio                                         | signed upload, MIME và size check                       | Chưa kiểm chứng với Supabase thật                                          |
| AI storyboard                                            | Claude/OpenAI adapters                                  | Chưa gọi API thật vì chưa có key/ngân sách                                 |
| AI ảnh/TTS/timestamp                                     | OpenAI adapter                                          | Chưa gọi API thật vì chưa có key/ngân sách                                 |
| Render MP4 FFmpeg                                        | `pnpm --filter @studio/worker smoke:render` + `ffprobe` | Đạt local: 4,03 giây, 1080 × 1920, H.264 + AAC, có nhạc nền                |
| Phụ đề tiếng Việt                                        | unit test UTF-8 ASS + font Noto trong Docker            | Unit test đạt; chưa kiểm chứng bằng MP4 thật                               |
| Tải lại khi job chạy                                     | job PostgreSQL + polling                                | Chưa kiểm chứng production                                                 |
| Thử lại job lỗi                                          | API retry, nút UI và giới hạn số lần                    | Code hoàn tất; chưa kiểm chứng production                                  |
| Mobile                                                   | viewport 390 × 844, kiểm tra DOM và ảnh chụp            | Đạt; preview, storyboard và thiết lập cùng truy cập được; không tràn ngang |
| GitHub Pages                                             | workflow Pages + mở URL public và URL con `/media`      | Đạt ngày 03/10/2026; routing trực tiếp không lỗi                            |

Lệnh nghiệm thu cuối `pnpm check` chạy thành công ngày 03/10/2026. GitHub Actions CI và workflow GitHub Pages cho commit tích hợp Claude/OpenAI đều chạy thành công; trang Cài đặt public đã hiển thị riêng trạng thái Claude, ChatGPT/OpenAI và FFmpeg tự host.

Không đánh dấu luồng AI là “đã kiểm chứng” cho đến khi gọi dịch vụ thật. Render lõi đã được kiểm tra bằng MP4 thật; riêng bước burn-in phụ đề trong container vẫn chờ Docker production có `libass` và Noto Sans. Chưa có Supabase project riêng, Cloudflare Tunnel, Claude key và OpenAI key nên chưa thể thực hiện các phép thử production còn lại.
