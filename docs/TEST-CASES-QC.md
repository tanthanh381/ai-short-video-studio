# Ma trận test case QC

Ngày kiểm thử: 04/10/2026. Môi trường: repository local, Docker/Colima self-host, GitHub Pages public.

## Quy ước

- **Đạt**: đã chạy và có bằng chứng trong log, test hoặc endpoint.
- **Chưa kiểm chứng**: cần thao tác tài khoản/email/file thật hoặc API trả phí; không được coi là tính năng đã nghiệm thu.
- Chế độ hiện tại là **0 đồng API**: không gọi OpenAI/Claude, nhưng vẫn hỗ trợ storyboard thủ công, upload media và render FFmpeg.

## Test case

| ID | Nhóm | Tiền điều kiện | Thực hiện | Kết quả mong đợi | Kết quả |
|---|---|---|---|---|---|
| QC-01 | Schema | Không cần | Chạy schema tests với project hợp lệ | Dữ liệu hợp lệ qua kiểm tra | Đạt |
| QC-02 | Schema | Không cần | Gửi source text quá ngắn, subtitle đảo thời gian | Bị từ chối bằng lỗi validation | Đạt |
| QC-03 | Zero-cost | Backend có `AI_FEATURES_ENABLED=false` | Đọc capability và mở màn hình tạo dự án | Nút AI hiện rõ cần API; upload thủ công vẫn khả dụng | Đạt qua code/build |
| QC-04 | API health | API chạy | `GET /health` | HTTP 200, trạng thái healthy | Đạt |
| QC-05 | API auth | Không có JWT | `GET /v1/projects` | HTTP 401, không lộ dữ liệu | Đạt |
| QC-06 | CORS | Origin `http://localhost:5173` | Gọi `/health` với header Origin | Có `access-control-allow-origin` đúng origin | Đạt |
| QC-07 | Routing | Frontend production | Mở `/media`, `/settings`, fallback 404 | SPA route không trắng trang; route không tồn tại có 404 | Đạt qua test routing/build |
| QC-08 | Type/build | Không cần | `pnpm check` | TypeScript, test và Vite build thành công | Đạt |
| QC-09 | Provider adapter | Không cần key | Chạy provider/config tests | Provider không tự gọi khi thiếu key; cấu hình được kiểm tra | Đạt |
| QC-10 | Render preset | FFmpeg container | Render preset 9:16, 1:1, 16:9 | Tạo đúng kích thước khung hình | Đạt qua unit + smoke render |
| QC-11 | Render MP4 | Có ảnh/audio test | Chạy smoke render trong worker container và `ffprobe` | MP4 thật có hình, H.264, AAC, thời lượng hữu ích | Đạt: 4,10 giây, 1080×1920 |
| QC-12 | Phụ đề | Audio và text tiếng Việt | Burn-in ASS có dấu, ngoặc, xuống dòng | Không lỗi font; ký tự đặc biệt được escape | Đạt |
| QC-13 | Thiếu media | Cảnh không có ảnh/audio | Gọi render | Từ chối rõ cảnh lỗi, không báo hoàn thành giả | Đạt |
| QC-14 | Public security | Bundle production và repository | Quét marker secret | Không có API key/backend secret trong bundle | Đạt; publishable key là cấu hình frontend được phép |
| QC-15 | Public UI | Có mạng | Mở URL Pages và các route chính | Trang đăng nhập hiển thị, không lỗi JS console quan sát được | Đạt |
| QC-16 | Đăng nhập thật | Email được allowlist | Gửi magic link, mở link | Người được phép vào dashboard; người ngoài bị chặn | Chưa kiểm chứng lại trong phiên QC này |
| QC-17 | Project CRUD | Đã đăng nhập | Tạo, sửa, đổi tên, nhân bản, xóa, tải lại | Dữ liệu lưu bền vững và đúng owner | Chưa kiểm chứng UI production |
| QC-18 | Upload | Đã đăng nhập | Upload ảnh/audio hợp lệ và file sai MIME/size | File hợp lệ tạo signed URL; file sai bị chặn | Chưa kiểm chứng UI production |
| QC-19 | Render queue | Có project đủ media | Bấm xuất, tải lại trang giữa job | Job bền vững, polling đúng trạng thái, MP4 tải được | Chưa kiểm chứng qua UI production |
| QC-20 | Retry | Tạo lỗi có kiểm soát | Bấm thử lại | Retry giới hạn, không tạo tác vụ trả phí trùng | Chưa kiểm chứng qua UI production |
| QC-21 | Mobile | Viewport 390×844 | Mở dashboard/studio | Không tràn ngang, thao tác chính vẫn dùng được | Đạt theo kiểm tra viewport trước; nên lặp lại khi có môi trường production mới |
| QC-22 | AI thật | Có key và ngân sách | Gọi storyboard/ảnh/TTS/transcription thật | Chỉ đánh dấu đạt khi provider trả kết quả thật | Chưa kiểm chứng; cố ý không phát sinh chi phí |

## Lệnh tái kiểm thử

```bash
pnpm check
pnpm --filter @studio/worker smoke:render
```

Smoke render phải chạy trong worker/container có FFmpeg và bộ lọc `subtitles`, không chạy trong GitHub Actions như hàng đợi người dùng. FFmpeg Homebrew trên máy QC thiếu bộ lọc này nên không được dùng để kết luận production render. Không commit media, video xuất hoặc secret vào repository.

## Kết luận QC

Các lớp schema, API bảo vệ, CORS, provider adapter, render lõi, phụ đề tiếng Việt, build và bundle public đã đạt. Không phát hiện lỗi production mới trong vòng tự động này; các lỗi trước đó liên quan chế độ thiếu API đã được khắc phục bằng trạng thái zero-cost rõ ràng và luồng upload/render thủ công. Các test cần email đăng nhập, file người dùng và provider AI thật vẫn được giữ ở trạng thái chưa kiểm chứng để tránh tuyên bố sai hoặc phát sinh phí.
