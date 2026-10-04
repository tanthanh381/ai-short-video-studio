# AI Short Video Studio

Studio tiếng Việt: đăng nhập, dán kịch bản và bấm **Tạo video**. Máy tự chia cảnh, tạo ảnh và giọng đọc, đồng bộ phụ đề, ghép MP4 rồi hiển thị xem trước và tải xuống.

- Website: https://tanthanh381.github.io/ai-short-video-studio/
- Source code public: https://github.com/tanthanh381/ai-short-video-studio

Ứng dụng được thiết kế cho một nhóm tài khoản được cấp quyền. Bản frontend có thể công khai trên GitHub Pages, nhưng mọi thao tác dữ liệu, AI và render đều được backend kiểm tra đăng nhập.

## Trạng thái hiện tại

- Giao diện React + TypeScript hoàn chỉnh cho máy tính và điện thoại.
- Luồng **một nút** đã hoạt động trên website công khai: chỉ nhập kịch bản, máy tự chia cảnh bằng Ollama, tạo ảnh ComfyUI, đọc tiếng Việt bằng macOS Linh, tạo phụ đề đúng lời gốc và ghép MP4 bằng FFmpeg. Không cần API key và không gọi API trả phí.
- Khi máy AI chưa được kết nối, vẫn có thể lưu bản nháp, sửa storyboard, tải ảnh/audio của mình lên và ghép MP4 khi worker sẵn sàng. Chế độ mẫu được ghi rõ và không trả video giả.
- API Express có xác thực Supabase, danh sách tài khoản được phép, signed upload/download, giới hạn file, rate limit, ngân sách ngày, idempotency và giới hạn tác vụ đồng thời.
- Worker có adapter Ollama/local và Claude/OpenAI tùy chọn, hàng đợi PostgreSQL bền vững, checkpoint từng bước và từng cảnh, retry giới hạn, heartbeat và FFmpeg render MP4 H.264/AAC.
- Migration Supabase tạo database, RLS và bucket riêng tư.
- GitHub Actions kiểm tra source và tự động triển khai GitHub Pages.
- Frontend production đã triển khai trên GitHub Pages và kết nối backend thật qua Tailscale Funnel. Studio phát MP4 đã xuất, tải file thực và làm mới quyền truy cập có thời hạn cho video riêng tư.

Đã chạy ba video thật từ kịch bản mới qua website công khai; kiểm tra quyền đăng nhập và chặn tài khoản ngoài danh sách, tải lại/đóng rồi mở trang khi tác vụ chạy, tiếp tục từ lỗi chia cảnh/lỗi media riêng một cảnh và giao diện điện thoại. Video cuối được tạo từ một ô và một nút, tải MP4 thực, lời đọc/phụ đề nguyên văn, 1080×1920 và 8,979 giây theo audio. Xem số liệu và bằng chứng tại [biên bản kiểm thử](docs/KIEM-THU.md).

Đã phát trọn MP4 nghiệm thu bằng QuickTime trên Mac: hình hai cảnh, chuyển cảnh và phụ đề tiếng Việt hiển thị đến đoạn kết. Audio AAC được giải mã, đo tín hiệu và kiểm tra độc lập bằng Whisper local; việc đánh giá chất giọng vẫn phụ thuộc cảm nhận người nghe. Ảnh local có thể xuất hiện lỗi hình và chưa bảo đảm cùng một nhân vật giữ diện mạo nhất quán giữa các cảnh. Máy Mac phải bật và các dịch vụ xử lý phải hoạt động; website vẫn mở được khi máy tắt nhưng không thể tạo video. OpenAI và Claude chưa được gọi thật, là lựa chọn mở rộng ngoài luồng mặc định.

## Cách sử dụng

1. Đăng nhập bằng email được cấp quyền và mật khẩu.
2. Chọn **Tạo video mới**, dán kịch bản vào ô duy nhất, bấm **Tạo video**.
3. Chờ xử lý; có thể tải lại hoặc mở lại dự án để theo dõi tiếp. Khi có lỗi, bấm **Tiếp tục**; cảnh đã thành công được giữ lại.
4. Khi hoàn thành, xem video trong Studio và bấm **Tải MP4**. Bản xuất cũng được lưu tại **Lịch sử xuất**.

Tên được đặt tự động. Mặc định video dọc 1080×1920, giọng Linh, phụ đề tiếng Việt và không nhạc. Giọng, tỷ lệ, nhạc và các bước chỉnh tay nằm trong phần thu gọn. Không tự viết lại kịch bản; khi không bật viết lại, nối lời đọc các cảnh khôi phục đúng nguyên văn đầu vào.

Luồng một nút chỉ dùng **Ollama + media local**, không tự chuyển sang API trả phí khi có key. Không mất phí API nhưng vẫn dùng điện, phần cứng và dung lượng Supabase trong hạn mức tài khoản. Máy chủ phải bật, không ngủ, và chạy Docker, Ollama, ComfyUI, cầu nối media, Tailscale Funnel.

Sau khi khởi động lại máy Mac đã được cấu hình, nhấp đúp `scripts/Mo-Video-Studio.command` để bật các thành phần và mở website; không cần nhập lệnh hoặc sửa cấu hình. Chờ máy khởi động xong các dịch vụ trước khi tạo video.

Không có API key vẫn dùng được luồng tự động khi Ollama, ComfyUI và máy xử lý đã kết nối. Nếu các thành phần local chưa sẵn sàng, có thể lưu bản nháp, sửa cảnh và dùng ảnh/audio tự tải lên; giao diện báo rõ phần đang thiếu kết nối.

## Kiến trúc

| Thành phần  | Công nghệ                                  | Vai trò                                             |
| ----------- | ------------------------------------------ | --------------------------------------------------- |
| Frontend    | React, TypeScript, Vite, GitHub Pages      | Studio, xem trước, chỉnh sửa và theo dõi job        |
| Backend     | Node.js, Express, Docker, Tailscale Funnel/Cloudflare Tunnel | Giữ secret, kiểm tra quyền, cấp signed URL, tạo job |
| Dữ liệu     | Supabase Auth, PostgreSQL, private Storage | Đăng nhập, metadata, hàng đợi bền vững và media     |
| Worker      | Node.js, FFmpeg, Noto Sans, Docker         | Gọi AI, checkpoint từng cảnh và render video        |
| AI văn bản  | Ollama (mặc định), Claude/OpenAI tùy chọn  | Prompt hình ảnh theo cảnh; lời gốc được khóa bằng code |
| AI media    | ComfyUI + macOS Linh (mặc định)            | Ảnh local, giọng đọc; phụ đề từ audio PCM đo thật     |

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

### Ollama cục bộ

Có thể chọn `Ollama (cục bộ)` ở phần AI chia cảnh. Worker Docker kết nối tới Ollama trên máy chủ qua `OLLAMA_BASE_URL` (mặc định `http://host.docker.internal:11434`) và dùng model `qwen2.5:3b`. Cài model bằng `ollama pull qwen2.5:3b`.

### Media AI cục bộ trên macOS

Pipeline không cần API trả phí: ComfyUI + checkpoint Analog Diffusion tạo ảnh, giọng `Linh` của macOS tạo TTS tiếng Việt. Mỗi cụm lời gốc được tổng hợp thành WAV; timestamp phụ đề là vị trí nối audio tính từ số mẫu PCM thực, không phải chia thời gian theo ký tự. Nhờ vậy chữ không bị Whisper nhận sai. Với audio tự tải lên, Whisper chỉ được chấp nhận khi chữ khớp kịch bản; nếu không, tác vụ dừng và yêu cầu chỉnh phụ đề hoặc tạo lại giọng local. Mã cầu nối nằm trong `local-tools/media_server.py`; model và môi trường Python local không được commit vào repository.

Khởi động ComfyUI trước, sau đó chạy cầu nối chỉ trên localhost:

```bash
local-tools/comfy-venv/bin/python local-tools/ComfyUI/main.py --cpu --listen 127.0.0.1 --port 8188
LOCAL_MEDIA_HOST=127.0.0.1 /opt/homebrew/bin/python3.12 local-tools/media_server.py
```

Trong `.env.selfhost`, bật `LOCAL_MEDIA_FEATURES_ENABLED=true` và giữ `LOCAL_MEDIA_BASE_URL=http://host.docker.internal:8765`, rồi rebuild worker. Tạo ảnh local bằng CPU mất khoảng một phút mỗi cảnh trên máy kiểm thử; chất lượng và tốc độ phụ thuộc phần cứng. Các model local là phần mềm miễn phí nhưng vẫn chịu giấy phép riêng của từng model.

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

Tên biến và placeholder nằm trong [.env.example](.env.example). Không đưa `.env`, Supabase secret, Claude key hoặc OpenAI key vào GitHub.

## Triển khai production

### 1. Supabase

- Tạo project Supabase.
- Dùng Supabase CLI liên kết project và áp dụng migration trong `supabase/migrations`.
- Tạo tài khoản Auth cho chủ sở hữu và thêm đúng tài khoản đó vào `allowed_users`.
- Giữ bucket `private-media` ở chế độ private.
- Để dùng đăng nhập bằng mật khẩu, vào **Authentication → Users**, chọn tài khoản,
  đặt mật khẩu hoặc dùng nút **Quên hoặc chưa có mật khẩu?** trên website. Tối
  thiểu 8 ký tự; không dùng lại mật khẩu ngân hàng.

Chủ sở hữu sản phẩm không cần tự chạy SQL; các bước migration và cấp quyền nên do kỹ thuật viên hoặc quy trình triển khai thực hiện.

### 2. Máy tự host và kết nối HTTPS public

API và worker chạy bằng `docker-compose.selfhost.yml`. Chỉ API đi qua Tailscale Funnel hoặc Cloudflare Tunnel; worker không có cổng public. Secret được chia theo nguyên tắc tối thiểu: API không nhận khóa AI, worker không nhận token Tunnel.

Nếu đã cài Tailscale, có thể dùng Funnel miễn phí thay cho Cloudflare:

```bash
tailscale funnel --bg --https=443 http://127.0.0.1:8787
tailscale funnel status
```

Đặt `VITE_API_URL` trong GitHub Actions bằng hostname HTTPS mà Funnel hiển thị. Hướng dẫn đầy đủ nằm tại [docs/TU-HOST.md](docs/TU-HOST.md).

Khi chưa có domain để tạo Tunnel ổn định, có thể chạy frontend GitHub Pages với `VITE_API_URL=http://localhost:8787`. Khi đó trình duyệt của anh gọi backend Docker trên chính máy đang sử dụng; không cần mua domain hoặc dịch vụ tunnel. Máy phải bật Docker khi tạo và xuất video.

Hướng dẫn vận hành nằm tại [docs/TU-HOST.md](docs/TU-HOST.md). Phương án này không có phí Railway nhưng máy chạy Docker phải bật khi tạo video.

### 3. GitHub Pages

Trong repository, vào **Settings → Secrets and variables → Actions → Variables** và tạo:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_API_URL` là hostname HTTPS của Tailscale Funnel hoặc Cloudflare Tunnel
- `VITE_DEMO_MODE=false`

Vào **Settings → Pages → Build and deployment**, chọn **GitHub Actions**. Mỗi lần push nhánh `main`, workflow sẽ build và publish thư mục `apps/web/dist`.

Sau khi có URL Pages, cập nhật `ALLOWED_ORIGINS` của API bằng đúng origin đó và
thêm cả hai URL sau vào Redirect URLs trong Supabase Auth:

- `https://tanthanh381.github.io/ai-short-video-studio/`
- `https://tanthanh381.github.io/ai-short-video-studio/reset-password`

## Chi phí và giới hạn

Không có dịch vụ trả phí nào được tự động mua hoặc nâng gói bởi source code này.

| Dịch vụ            | Mức khởi đầu                   | Cách phát sinh chi phí                                                    |
| ------------------ | ------------------------------ | ------------------------------------------------------------------------- |
| GitHub Pages       | Gói miễn phí phù hợp frontend  | Lưu trữ và băng thông theo hạn mức GitHub Pages                           |
| Supabase           | Có gói Free                    | Database, storage, egress và số người dùng theo hạn mức                   |
| Cloudflare Tunnel  | Có thể dùng gói Free           | Domain riêng nếu chọn mua; lưu lượng theo chính sách Cloudflare           |
| Máy chạy Docker    | Không có phí nền tảng riêng    | Điện, mạng và phần cứng do chủ dự án cung cấp                             |
| Claude API         | Trả theo sử dụng               | Token đầu vào/đầu ra khi tạo storyboard                                   |
| OpenAI API         | Trả theo sử dụng               | Token văn bản, số ảnh/chất lượng ảnh, TTS và transcription                |

Giá và hạn mức có thể thay đổi. Trước khi bật production, kiểm tra trang giá chính thức của [Supabase](https://supabase.com/pricing), [Cloudflare](https://www.cloudflare.com/plans/), [Anthropic](https://www.anthropic.com/pricing) và [OpenAI](https://openai.com/api/pricing/). Ứng dụng hiển thị ước tính trước khi tạo media, áp dụng ngân sách ngày và mặc định chỉ chạy một job đồng thời.

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

Lệnh đầu chạy typecheck, unit test và production build. Lệnh thứ hai tạo một MP4 dọc ngắn bằng FFmpeg và kiểm tra H.264, AAC, kích thước cùng thời lượng; cần FFmpeg local. Kết quả chạy thật trên website công khai và các phần chưa hoàn tất nghiệm thu được ghi tại [docs/KIEM-THU.md](docs/KIEM-THU.md).

## Phong cách nội dung tham khảo

Không truy cập được nội dung công khai của trang Facebook tham khảo trong môi trường triển khai, nên bản đầu dùng phong cách mặc định: kể chuyện tiếng Việt, mở đầu ngắn, hình minh họa theo cảnh, giọng đọc tự nhiên, phụ đề rõ và video dọc. Dự án không sao chép video, tên thương hiệu hoặc tài sản của trang đó.
