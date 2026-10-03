# Biên bản kiểm thử

Ngày lập: 02/10/2026

| Hạng mục                                                 | Cách kiểm tra                                           | Trạng thái                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------- |
| TypeScript toàn monorepo                                 | `pnpm typecheck`                                        | Đạt ngày 02/10/2026                                                        |
| Unit test schema, API auth, routing Pages, timestamp ASS | `pnpm test`                                             | Đạt: 8/8 test                                                              |
| Build React production                                   | `pnpm build`                                            | Đạt; bundle JS 329,69 kB (gzip 101,83 kB)                                  |
| Frontend không chứa secret                               | quét source và bundle + kiểm tra CI                     | Đạt trên bản local; CI đã cấu hình                                         |
| Đăng nhập và chặn người ngoài                            | test API 401 + middleware `allowed_users`               | Test 401 đạt; chưa kiểm chứng với Supabase thật                            |
| Tạo/sửa/lưu dự án                                        | chế độ mẫu local + API thật                             | Chế độ mẫu đạt; chưa kiểm chứng với Supabase thật                          |
| Upload ảnh/audio                                         | signed upload, MIME và size check                       | Chưa kiểm chứng với Supabase thật                                          |
| AI storyboard/ảnh/TTS/timestamp                          | OpenAI adapters                                         | Chưa gọi API thật vì chưa có key/ngân sách                                 |
| Render MP4 FFmpeg                                        | `pnpm --filter @studio/worker smoke:render` + `ffprobe` | Đạt local: 4,03 giây, 1080 × 1920, H.264 + AAC, có nhạc nền                |
| Phụ đề tiếng Việt                                        | unit test UTF-8 ASS + font Noto trong Docker            | Unit test đạt; chưa kiểm chứng bằng MP4 thật                               |
| Tải lại khi job chạy                                     | job PostgreSQL + polling                                | Chưa kiểm chứng production                                                 |
| Thử lại job lỗi                                          | API retry, nút UI và giới hạn số lần                    | Code hoàn tất; chưa kiểm chứng production                                  |
| Mobile                                                   | viewport 390 × 844, kiểm tra DOM và ảnh chụp            | Đạt; preview, storyboard và thiết lập cùng truy cập được; không tràn ngang |
| GitHub Pages                                             | workflow Pages                                          | Chưa triển khai vì repository chưa có remote GitHub                        |

Lệnh nghiệm thu cuối `pnpm check` chạy thành công ngày 02/10/2026.

Không đánh dấu luồng AI là “đã kiểm chứng” cho đến khi gọi dịch vụ thật. Render lõi đã được kiểm tra bằng MP4 thật; riêng bước burn-in phụ đề trong container vẫn chờ Docker production có `libass` và Noto Sans. Chưa được cung cấp Supabase project, Railway project hoặc OpenAI API key nên chưa thể thực hiện các phép thử production còn lại.
