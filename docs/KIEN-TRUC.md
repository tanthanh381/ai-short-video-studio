# Kiến trúc triển khai

```text
GitHub Pages (React)
       │ JWT người dùng
       ▼
Tailscale Funnel ── API Express trong Docker ── Supabase Auth/Postgres/Storage
                              │                              ▲
                              │ job bền vững                 │ media + trạng thái
                              ▼                              │
                       Worker Docker + FFmpeg  (máy chính: Mac mini)
                              │
                              │  bộ cân tải: đánh giá máy khả dụng, chạy một máy hay song song
                              ├────────────────────────────┬──────────────────────────────┐
                              ▼                            ▼                              ▼
                  Máy chính (mini)               Máy phụ (MacBook Air, tùy chọn)     Claude/OpenAI
                  Ollama · ảnh SDXL-Turbo        cùng bộ dịch vụ AI, qua Tailscale    chỉ khi người dùng
                  VieNeu/Piper · Whisper         + token, không giữ khóa nào          tự nhập khóa
                  máy vẽ tay
```

## Quyết định chính

- Frontend tĩnh đặt trên GitHub Pages đúng yêu cầu. Router có `404.html` để mở trực tiếp URL con không lỗi.
- Supabase gom đăng nhập, PostgreSQL và object storage. Bucket media là private; API chỉ cấp URL có thời hạn sau khi kiểm tra quyền.
- API và worker tách riêng. API không giữ request trong suốt thời gian render.
- API và worker chạy thành hai container trên máy cá nhân/NAS/VPS. Tailscale Funnel mở HTTPS bằng kết nối outbound, không cần mở cổng router.
- Worker có FFmpeg và font Noto Sans, lấy job bằng `FOR UPDATE SKIP LOCKED`. Job có heartbeat, retry giới hạn và được khôi phục nếu worker bị gián đoạn.
- Mỗi cảnh lưu media độc lập. Cảnh đã thành công không bị tạo lại khi cảnh khác lỗi.
- Phụ đề dùng timestamp tính từ số mẫu PCM thật của giọng đọc local (hoặc Whisper local cho audio tự tải lên), sau đó mới cập nhật timeline.

## Vì sao không render trên GitHub Actions hoặc serverless request

GitHub Actions là hệ thống CI/CD, không phải hàng đợi render cho người dùng. Các request serverless có giới hạn CPU và không phù hợp với FFmpeg dài. Worker Docker trên máy do chủ dự án kiểm soát có CPU, file tạm và tiến trình nền cần thiết mà không phát sinh phí nền tảng render riêng.

Phương án này không có phí thuê Railway, nhưng không thể gọi là “miễn phí và không giới hạn”: máy phải luôn bật, dùng điện/băng thông; Supabase và API AI vẫn có hạn mức hoặc phí theo chính sách của từng dịch vụ.

## An toàn dữ liệu

- API kiểm tra JWT và bảng `allowed_users` cho mọi endpoint `/v1`.
- RLS bật trên toàn bộ bảng public; policy luôn kèm điều kiện chủ sở hữu.
- Supabase secret chỉ cấp cho API/worker; khóa Claude và OpenAI chỉ cấp cho worker. Frontend và repository không chứa secret. Máy phụ không giữ secret nào; nó chỉ nhận yêu cầu từ worker qua Tailscale kèm `NODE_TOKEN`.
- Log loại bỏ Authorization, token, password và cookie.
- File bị giới hạn MIME, dung lượng và đường dẫn theo `user/project`.
- Job dùng idempotency key, giới hạn đồng thời và ngân sách ngày.
- Thư mục render tạm bị xóa ngay sau khi upload. Media dự án bị xóa theo quy trình xóa dự án.

## Cân tải giữa các máy

Mã nằm ở `apps/worker/src/node-*.ts`, `pooled-media.ts` và `local-tools/node_status.py`.

- **Máy phụ là nút tính toán, không phải worker thứ hai.** Chỉ worker ở máy chính nhận job từ hàng đợi và ghi vào Supabase; máy phụ trả ảnh, giọng, nhận dạng và video vẽ tay qua HTTP. Nhờ đó một job vẫn có một checkpoint duy nhất, và máy phụ có thể tắt bất cứ lúc nào.
- **`GET /node-status`** của media bridge báo khả năng (ảnh, giọng, Whisper, LTX), model và engine có sẵn, RAM/pin/nhiệt/tải, thời gian trung bình đã đo, trạng thái tạm dừng và dấu vân tay thông số + mã. Bridge cũ chưa có endpoint này vẫn dùng được cho máy chính (worker đọc `/health`), nhưng máy phụ cần bản mới để kiểm chứng cấu hình khớp.
- **Đánh giá khả dụng** (`node-plan.ts`) là hàm thuần: từ trạng thái một máy trả về nhận hay không nhận một loại việc, lý do, hệ số chậm và thời gian khởi động.
- **Quyết định song song hay một máy** (`planLane`) mô phỏng lịch "máy nào xong sớm nhất nhận việc" cho cả đợt, thêm một máy chỉ khi nhanh hơn đủ ngưỡng. Khi chạy, mỗi máy kéo việc từng cái một và chỉ nhận việc nếu mô phỏng lịch còn lại vẫn giao cho nó, nên máy chậm không kéo dài đợt ở cảnh cuối.
- **Chịu lỗi:** thăm dò mỗi 5 giây; hai lần liền không thấy thì máy bị coi là mất và các yêu cầu đang bay tới nó bị hủy ngay (không chờ hết timeout 15 phút). Việc đó được giao lại máy khác. Lỗi do chính yêu cầu (HTTP 4xx) không thử lại ở máy khác; lỗi ở bước lưu kết quả (Supabase, upload) không bị tính là lỗi của máy.
- **Một máy:** khi `AI_NODES` trống, `NodePool` chỉ chuyển tiếp tới máy chính, không thăm dò, các cảnh chạy tuần tự đúng thứ tự cũ.
