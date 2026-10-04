# Biên bản kiểm thử

Ngày lập: 02/10/2026. Cập nhật QC: 04/10/2026.

| Hạng mục                                                 | Cách kiểm tra                                           | Trạng thái                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------- |
| TypeScript toàn monorepo                                 | `pnpm typecheck`                                        | Đạt ngày 02/10/2026                                                        |
| Unit test schema, API auth, CORS, routing, provider, timestamp, render validation | `pnpm test`                                             | Đạt: 17/17 test ngày 04/10/2026                                            |
| Build React production                                   | `pnpm build`                                            | Đạt; bundle JS 331,89 kB (gzip 102,25 kB)                                  |
| Frontend không chứa secret                               | quét source và bundle + kiểm tra CI                     | Đạt local và GitHub Actions                                                 |
| Đăng nhập và chặn người ngoài                            | Supabase Auth + API 401/403/200 + `allowed_users`        | Đạt với phiên Supabase thật; đã sửa và xác minh quyền `service_role`       |
| Tạo/sửa/lưu dự án                                        | chế độ 0 đồng API + API thật                            | Giao diện đã bật chế độ backend thật; dự án đã được tạo và worker đọc được |
| Upload ảnh/audio                                         | signed upload, MIME và size check                       | Media thủ công đã được lưu trong bucket private và dùng để render production |
| AI storyboard                                            | Ollama adapter                                           | Đạt: worker gọi Ollama local `qwen2.5:3b` và nhận storyboard JSON thật       |
| AI ảnh/TTS/timestamp                                     | ComfyUI + macOS TTS Linh + whisper.cpp local            | Đạt: worker tạo ảnh/audio/timestamp thật; không dùng API trả phí            |
| Render MP4 FFmpeg                                        | smoke test trong container + `ffprobe`                  | Đạt: 4,10 giây, 1080 × 1920, H.264 + AAC, có nhạc nền                      |
| Phụ đề tiếng Việt                                        | burn-in ASS + font Noto trong container                 | Đạt; thumbnail thật hiển thị đúng “Xin chào Việt Nam”                      |
| Tải lại khi job chạy                                     | job PostgreSQL + polling                                | Đạt ở worker production: job được claim và hoàn thành |
| Thử lại job lỗi                                          | API retry, nút UI và giới hạn số lần                    | Code hoàn tất; chưa tạo lỗi có kiểm soát để kiểm chứng lại trên UI          |
| Mobile                                                   | viewport 390 × 844, kiểm tra DOM và ảnh chụp            | Đạt; preview, storyboard và thiết lập cùng truy cập được; không tràn ngang |
| GitHub Pages                                             | workflow Pages + mở URL public và URL con `/media`      | Đạt ngày 03/10/2026; routing trực tiếp không lỗi                            |

Lệnh nghiệm thu cuối `pnpm check` chạy thành công ngày 04/10/2026: typecheck, 20 unit test và production build. Worker production đã chạy job local media thật: ComfyUI tạo ảnh, macOS TTS tạo audio, whisper.cpp tạo timestamp, sau đó export MP4 trạng thái `completed`, 521.203 byte, 1080 × 1920, H.264 + AAC, thời lượng 4,3 giây. GitHub Actions CI và workflow GitHub Pages cho các commit trước đều chạy thành công.

Luồng AI local đã được kiểm chứng bằng dịch vụ thật trên máy: Ollama storyboard, ComfyUI ảnh, TTS Linh, whisper.cpp timestamp và worker render MP4. OpenAI/Claude vẫn chưa được gọi vì không có key; đây là phần tùy chọn. API và worker chạy bằng Docker/Colima trên máy tự host. Supabase project riêng, schema, RLS, bucket, Auth user và allowlist đã được tạo và kiểm tra qua API.
