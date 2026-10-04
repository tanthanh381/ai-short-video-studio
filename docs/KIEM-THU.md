# Biên bản kiểm thử

Cập nhật ngày 04/10/2026. Website: https://tanthanh381.github.io/ai-short-video-studio/. Backend qua Tailscale Funnel; Ollama, ComfyUI, giọng Linh và FFmpeg chạy trên máy Mac của chủ sở hữu. Không gọi API AI trả phí.

## Luồng chỉ nhập kịch bản

Trên màn hình **Tạo video mới**, người kiểm thử chỉ dán kịch bản và bấm **Tạo video** một lần. Không nhập tên, prompt, không thêm cảnh và không bấm riêng bước tạo media/render. Tên được đặt tự động; tùy chọn thu gọn; mặc định dọc 1080×1920, phụ đề bật, không nhạc.

Ba lượt đã tải MP4 thực qua nút trên website:

| Lượt | Dự án | Kết quả file tải xuống |
| --- | --- | --- |
| 1 | `685cca66-b7b3-410c-a7c2-6ae49eeea7b6` | 3 cảnh; H.264 1080×1920, 30 fps; AAC 48 kHz mono; 3.328.038 byte; 13,248 giây |
| 2 | `c5a9de90-1af5-4e9c-833f-396ed1222c03` | 3 cảnh; H.264 1080×1920, 30 fps; AAC 48 kHz mono; 2.780.223 byte; 10,643 giây |
| 3 | `59752730-fd54-48fc-8a58-cb365ffdd44c` | 2 cảnh; H.264 1080×1920, 30 fps; AAC 48 kHz mono; 2.186.241 byte; 8,979 giây; thành công ngay lần đầu |

Lượt 1 nhập:

> Buổi sáng, Lan mở cửa sổ và tưới chậu cây nhỏ trên bàn.
> Giữa ngày, cô đặt điện thoại xuống để dùng bữa cùng mẹ.
> Buổi tối, Lan ghi lại ba điều biết ơn rồi ngủ sớm.

Lượt 2 nhập:

> Buổi sáng, Lan tưới chậu cây bên cửa sổ.
> Buổi trưa, cô cùng mẹ ăn cơm trong căn bếp.
> Buổi tối, Lan ngồi viết nhật ký dưới ánh đèn bàn.

Lượt 1 phát hiện ảnh cuối chỉ có phòng ngủ, chưa thể hiện hành động ghi chép. Đã sửa prompt thành câu tiếng Anh ngắn, đưa hành động/vật thể chính lên đầu và tăng ComfyUI từ 8 lên 16 bước. Lượt 2 tốt hơn nhưng bút và sổ chưa rõ; tiếp tục bổ sung ràng buộc vật thể cho hành động viết/tưới. Không sửa lời đọc để che lỗi hình ảnh.

Lượt 3 nhập:

> Buổi sáng, Lan tưới chậu hoa nhỏ bên cửa sổ.
> Buổi tối, cô ngồi vào bàn và viết ba điều biết ơn trong cuốn nhật ký.

Lượt 3 có ảnh người/chậu cây bên cửa sổ và cận cảnh tay, bút, sổ mở. Cảnh cây chưa thể hiện dòng nước rõ; ảnh viết có chi tiết bàn tay chưa tự nhiên. Đây là giới hạn chất lượng model local, không ghi thành ảnh hoàn hảo. Lời đọc nối cảnh và chữ phụ đề đều khớp nguyên văn. Tổng audio đo 8.981 ms, MP4 8.979 ms (chênh 2 ms); không kéo dài hình để đạt thời lượng mục tiêu. Whisper kiểm tra độc lập audio MP4 nhận đúng toàn bộ kịch bản lượt 3. Âm thanh trung bình -17,3 dB, đỉnh -1 dB.

Đã đóng hẳn tab đang tạo ảnh rồi mở lại URL dự án lượt 3: cùng job `2b5c4015-d27d-4164-8bdc-2722b282e726` tiếp tục và hoàn thành. Xem trước MP4 trên trình duyệt chạy tới hết 8,979 giây; `readyState=4`, không lỗi media, kích thước video 1080×1920. File tải xuống đã được giải mã bằng FFmpeg để kiểm tra hình và audio.

## Kết quả kiểm tra thực tế

| Hạng mục | Bằng chứng | Kết quả |
| --- | --- | --- |
| Không thay lời gốc | Đối chiếu `source_text`, nối `scenes.narration` và nối chữ phụ đề trong database | Khớp nguyên văn, kể cả dấu tiếng Việt và xuống dòng |
| Audio theo lời gốc | WAV tạo từ cụm nguyên văn; giải mã audio MP4 và chạy Whisper kiểm tra độc lập | Đủ câu, đúng thứ tự lượt 1; Whisper tự nhận sai dấu ở “ngày”, không dùng chữ sai làm phụ đề |
| Thời lượng thực | Tổng PCM lượt 1 là 13.240 ms, MP4 13.248 ms | Chênh 8 ms do đóng gói audio; không kéo lên mục tiêu 60 giây |
| Timestamp phụ đề | Đo số mẫu PCM thực từng cụm TTS rồi nối WAV, cue dùng chính lời gốc | Không chia đều theo ký tự, không dùng Whisper để viết lại chữ TTS local |
| Hình/âm thanh/phụ đề | Giải mã MP4 tải về, lấy khung hình từng cảnh; `ffprobe`, `volumedetect` | Có ảnh, chữ tiếng Việt không lỗi font, audio có tín hiệu; lượt 1 trung bình -17,4 dB, đỉnh -1 dB |
| Tải lại khi đang xử lý | Tải lại Studio lượt 1 khi tạo media/render | Cùng tác vụ tiếp tục đến hoàn thành, không tạo lại dự án |
| Tiếp tục lỗi | Lượt 2 lỗi dữ liệu Ollama ở chia cảnh; sửa schema prompt-only rồi bấm **Tiếp tục từ bước lỗi** | Cùng tác vụ tiếp tục, tự tạo media và render thành công |
| Lỗi một cảnh, giữ cảnh thành công | Fixture QC riêng `bbf59cab-988d-4fad-aeb8-b69db411b6d5`: cảnh 1 ready, cảnh 2 cố ý thiếu audio | Dừng sau đúng 3 lần thử; ảnh/audio/cue/thời lượng cảnh 1 và SHA-256 hai file không đổi. Khôi phục audio cảnh 2 rồi bấm **Tiếp tục từ bước lỗi** trên website: xuất MP4 thật thành công, không tạo lại media cảnh 1 |
| Điện thoại | Viewport 390×844, DOM và ảnh chụp trực tiếp | Không tràn ngang; các phần của Studio và nút tải truy cập được |
| Chặn chưa đăng nhập | POST `/v1/videos` trên backend công khai | HTTP 401 |
| Chặn tài khoản ngoài danh sách | Tài khoản Auth tạm đăng nhập thật, không thêm allowlist, gọi API | HTTP 403; đã xóa đúng tài khoản QC tạm, không đổi tài khoản hiện có |
| Lưu nguyên tử và chống trùng | `supabase/tests/pipeline_regressions.sql` trên production trong transaction rollback | Đạt: rollback sửa cảnh lỗi; cùng key chỉ có một dự án/job; sửa nội dung về nháp; tiếp tục dự án cũ giữ cảnh; không dùng bản xuất cũ cho job mới |

## Kiểm thử tự động

`pnpm check` đã đạt: typecheck, 95 test TypeScript (worker 67, web 12, API 11, shared 5), build React production. Bundle JavaScript 345,56 kB, gzip 105,85 kB. Python thêm 5/5 test cầu nối local đạt. Tổng cộng 100 test tự động.

Regression kiểm tra nguyên văn, số lượng cảnh, timestamp/diacritics, TTS PCM, prompt đúng hành động, JSON provider lỗi, miễn phí mặc định, idempotency, permission, checkpoint/retry, cảnh sẵn sàng không tạo lại, duration thực, phiên xem trước và autosave. Sandbox không mở được cổng API báo `listen EPERM`; đã chạy lại với quyền local listener và toàn bộ API tests đạt.

Quét 45 file source thay đổi/mới và 5 file bundle gồm sourcemap bằng pattern và đối chiếu secret backend thực: không có PAT, khóa AI, Supabase secret/service-role JWT hoặc private key. Chỉ `.env.example`/`.env.selfhost.example` placeholder được commit; model, media, database và MP4 không commit.

## Giới hạn và phần chưa xác minh

- Chưa chốt nghe/xem trọn MP4 bằng trình phát native: màn hình Mac đang khóa nên không điều khiển được QuickTime. Giải mã và kiểm tra khung hình/audio không thay thế đánh giá chủ quan toàn bộ lời đọc.
- Lỗi chia cảnh và lỗi một cảnh media đã được thử trên UI. Fixture media dùng bản sao trong prefix riêng, không sửa dự án nghiệm thu gốc; các dữ liệu QC tạm được dọn sau đối chiếu.
- Ảnh local có thể sai chi tiết, tay/bút, chưa bảo đảm diện mạo nhân vật nhất quán giữa cảnh. Không cam kết chất lượng tương đương mọi video tham khảo.
- Giọng Linh là giọng hệ thống, không phải giọng diễn viên. Với audio tải lên, Whisper chỉ được chấp nhận khi khớp lời gốc; lệch chữ sẽ báo lỗi thay vì âm thầm đổi phụ đề.
- Máy Mac phải bật, không ngủ và chạy các dịch vụ. Frontend vẫn mở được khi máy tắt nhưng không tạo/render được video.
- OpenAI/Claude và API trả phí chưa được gọi trong đợt nghiệm thu này; không đánh dấu đã kiểm chứng.
- Supabase/GitHub/Tailscale chịu hạn mức tài khoản; không cam kết miễn phí không giới hạn. Không tự nâng gói.
