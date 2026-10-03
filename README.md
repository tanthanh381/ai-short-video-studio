# AI Short Video Studio

Studio tiếng Việt để sản xuất video ngắn theo luồng: nhập ý tưởng hoặc kịch bản → chia cảnh → tạo ảnh và giọng đọc → đồng bộ phụ đề từ audio thật → render MP4 → tải video.

Ứng dụng được thiết kế cho một nhóm tài khoản được cấp quyền. Bản frontend có thể công khai trên GitHub Pages, nhưng mọi thao tác dữ liệu, AI và render đều được backend kiểm tra đăng nhập.

## Trạng thái hiện tại

- Giao diện React + TypeScript hoàn chỉnh cho máy tính và điện thoại.
- Có chế độ mẫu để xem và sửa storyboard khi chưa cấu hình dịch vụ. Chế độ này được ghi rõ trên giao diện và không giả lập AI hay video đầu ra.
- API Express có xác thực Supabase, danh sách tài khoản được phép, signed upload/download, giới hạn file, rate limit, ngân sách ngày, idempotency và giới hạn tác vụ đồng thời.
- Worker có adapter OpenAI, hàng đợi PostgreSQL bền vững, checkpoint theo cảnh, retry giới hạn, heartbeat và FFmpeg render MP4 H.264/AAC.
- Migration Supabase tạo database, RLS và bucket riêng tư.
- GitHub Actions kiểm tra source và tự động triển khai GitHub Pages.

Luồng AI thật và render production chỉ được đánh dấu đã kiểm chứng sau khi kết nối tài khoản dịch vụ, cấp API key và chạy video nghiệm thu. Xem [biên bản kiểm thử](docs/KIEM-THU.md).

## Cách sử dụng

1. Đăng nhập bằng tài khoản đã được cấp quyền.
2. Chọn **Tạo dự án mới**, nhập tên video và ý tưởng hoặc kịch bản.
3. Nếu đây là kịch bản hoàn chỉnh, chọn đúng loại nội dung. Hệ thống mặc định giữ nguyên câu chữ và chỉ chia cảnh; chỉ bật viết lại khi thật sự cần.
4. Trong Studio, chọn **Chia cảnh**. Có thể sửa lời đọc, prompt ảnh, thứ tự, thêm hoặc xóa cảnh.
5. Chọn **Tạo media**. Màn hình sẽ hiện chi phí ước tính trước khi xác nhận.
6. Nghe thử giọng đọc, xem ảnh từng cảnh, thay ảnh/audio riêng hoặc tạo lại một cảnh nếu cần.
7. Sửa nội dung và thời điểm phụ đề; chọn màu, nền, viền và vị trí.
8. Nếu dùng nhạc, chỉ tải file có quyền sử dụng. Chỉnh âm lượng nhạc thấp hơn giọng đọc.
9. Chọn **Xuất video**, theo dõi tiến độ rồi tải MP4 ở **Lịch sử xuất**.

Nếu chưa có API key, vẫn có thể tạo dự án, sửa storyboard, tải ảnh/audio của mình lên và chuẩn bị cấu hình. Nút AI/render sẽ báo rõ dịch vụ chưa được kết nối.

## Kiến trúc

| Thành phần  | Công nghệ                                  | Vai trò                                             |
| ----------- | ------------------------------------------ | --------------------------------------------------- |
| Frontend    | React, TypeScript, Vite, GitHub Pages      | Studio, xem trước, chỉnh sửa và theo dõi job        |
| Backend     | Node.js, Express, Railway                  | Giữ secret, kiểm tra quyền, cấp signed URL, tạo job |
| Dữ liệu     | Supabase Auth, PostgreSQL, private Storage | Đăng nhập, metadata, hàng đợi bền vững và media     |
| Worker      | Node.js, FFmpeg, Noto Sans, Railway        | Gọi AI, checkpoint từng cảnh và render video        |
| AI mặc định | OpenAI adapter                             | Storyboard, ảnh, TTS và word timestamp              |

Frontend không chứa secret. Worker render là một service riêng có CPU, dung lượng tạm và thời gian chạy phù hợp; GitHub Actions không được dùng làm hàng đợi video.

Chi tiết: [Kiến trúc triển khai](docs/KIEN-TRUC.md).

## Cấu trúc source

```text
apps/web       Frontend React
apps/api       Backend Express
apps/worker    Worker AI + FFmpeg
packages/shared  Schema Zod và kiểu dữ liệu dùng chung
supabase       Migration database, RLS và storage
.github/workflows  CI và GitHub Pages
```

## Chạy local cho kỹ thuật viên

Yêu cầu Node.js 24, pnpm 11.19 và FFmpeg nếu chạy worker ngoài Docker.

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm typecheck
pnpm test
pnpm build
```

Chạy từng service:

```bash
pnpm dev
pnpm dev:api
pnpm dev:worker
```

Tên biến và placeholder nằm trong [.env.example](.env.example). Không đưa `.env`, service-role key hoặc OpenAI key vào GitHub.

## Triển khai production

### 1. Supabase

- Tạo project Supabase.
- Dùng Supabase CLI liên kết project và áp dụng migration trong `supabase/migrations`.
- Tạo tài khoản Auth cho chủ sở hữu và thêm đúng tài khoản đó vào `allowed_users`.
- Giữ bucket `private-media` ở chế độ private.

Chủ sở hữu sản phẩm không cần tự chạy SQL; các bước migration và cấp quyền nên do kỹ thuật viên hoặc quy trình triển khai thực hiện.

### 2. Railway

Tạo hai service từ cùng repository:

- API dùng `railway.api.json` và `Dockerfile.api`.
- Worker dùng `railway.worker.json` và `Dockerfile`.

Đặt secret ở Railway, không đặt ở frontend:

- Cả hai service: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`.
- API: `ALLOWED_ORIGINS`, `DAILY_BUDGET_USD`, `MAX_CONCURRENT_JOBS`, `MAX_UPLOAD_MB`. Sau khi worker và OpenAI đã sẵn sàng, đặt `AI_FEATURES_ENABLED=true` và `RENDER_WORKER_ENABLED=true` để giao diện báo đúng trạng thái.
- Worker: `OPENAI_API_KEY` và các biến `OPENAI_*_MODEL` nếu muốn đổi model.

API cần một public domain. Worker không cần public domain.

### 3. GitHub Pages

Trong repository, vào **Settings → Secrets and variables → Actions → Variables** và tạo:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_API_URL` là domain của Railway API
- `VITE_DEMO_MODE=false`

Vào **Settings → Pages → Build and deployment**, chọn **GitHub Actions**. Mỗi lần push nhánh `main`, workflow sẽ build và publish thư mục `apps/web/dist`.

Sau khi có URL Pages, cập nhật `ALLOWED_ORIGINS` của API bằng đúng origin đó và thêm URL vào Redirect URLs trong Supabase Auth.

## Chi phí và giới hạn

Không có dịch vụ trả phí nào được tự động mua hoặc nâng gói bởi source code này.

| Dịch vụ      | Mức khởi đầu tham khảo            | Cách phát sinh chi phí                                                              |
| ------------ | --------------------------------- | ----------------------------------------------------------------------------------- |
| GitHub Pages | Miễn phí với public repository    | Lưu trữ và băng thông theo giới hạn GitHub Pages                                    |
| Supabase     | Free: 0 USD; Pro từ 25 USD/tháng  | Database, storage, egress, số người dùng; Free có thể pause project không hoạt động |
| Railway      | Hobby 5 USD/tháng gồm 5 USD usage | RAM, CPU, storage và network usage của API/worker                                   |
| OpenAI API   | Trả theo sử dụng                  | Model văn bản, số ảnh/chất lượng ảnh, TTS và transcription                          |

Giá có thể thay đổi. Trước khi bật production, kiểm tra lại trang giá chính thức của [Supabase](https://supabase.com/pricing), [Railway](https://railway.com/pricing) và [OpenAI](https://openai.com/api/pricing/). Ứng dụng hiển thị ước tính trước khi tạo media, áp dụng ngân sách ngày và mặc định chỉ chạy một job đồng thời.

## Bảo mật và vận hành

- Mọi endpoint `/v1` xác thực JWT và kiểm tra `allowed_users` tại backend.
- RLS giới hạn dữ liệu theo chủ sở hữu; bucket media không public.
- URL upload/download có thời hạn và bị ràng buộc theo `user/project`.
- MIME và dung lượng file được kiểm tra; tên file được làm sạch.
- Authorization, token, password, cookie và API key không được ghi log.
- Job trả phí có idempotency key, retry tối đa và timeout/heartbeat để tránh treo vô hạn.
- File render tạm được xóa sau mỗi job; media được xóa khi xóa dự án; media tạo lại cũ được dọn mà không xóa file người dùng tải lên.
- GitHub Actions quét chuỗi giống secret trong bundle frontend.

## Kiểm thử

```bash
pnpm check
pnpm --filter @studio/worker smoke:render
```

Lệnh đầu chạy typecheck, unit test và production build. Lệnh thứ hai tạo một MP4 dọc ngắn bằng FFmpeg và kiểm tra H.264, AAC, kích thước cùng thời lượng; cần FFmpeg local. Kết quả nghiệm thu và các phần chưa thể kiểm chứng khi thiếu tài khoản/key được ghi tại [docs/KIEM-THU.md](docs/KIEM-THU.md).

## Phong cách nội dung tham khảo

Trang Facebook công khai được tham khảo ở mức nhịp kể: câu mở đầu ngắn, nội dung chiêm nghiệm tiếng Việt, hình theo cảnh và thời lượng ngắn. Dự án không sao chép video, tên thương hiệu hoặc tài sản của trang đó.
