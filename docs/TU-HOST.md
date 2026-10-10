# Chạy backend và worker trên máy riêng

Phương án này giữ frontend trên GitHub Pages và chạy API/FFmpeg trên máy cá nhân, mini PC, NAS hoặc VPS có Docker. Tailscale Funnel cấp địa chỉ HTTPS công khai mà không cần mở cổng mạng.

## Chuẩn bị một lần

1. Cài Docker Desktop và bảo đảm máy có thể chạy liên tục khi cần tạo video.
2. Tạo một project Supabase Free riêng cho ứng dụng.
3. Chạy migration trong thư mục `supabase/migrations` theo đúng thứ tự.
4. Tạo tài khoản đăng nhập trong Supabase Authentication và thêm `user_id` đó vào bảng `allowed_users`.
5. Chọn Tailscale Funnel (không cần domain riêng), hoặc chạy frontend trên chính máy backend với `VITE_API_URL=http://localhost:8787`.
6. API key OpenAI và Anthropic là tùy chọn. Có thể để trống cả hai và chạy chế độ local-first bằng Ollama, image server SDXL-Turbo/MLX, VieNeu/Piper hoặc TTS Linh của macOS và whisper.cpp.

## Cấu hình bí mật

Sao chép `.env.selfhost.example` thành `.env.selfhost`, rồi điền các giá trị thật ngay trên máy chạy Docker. Không gửi key qua chat và không commit file này.

```bash
cp .env.selfhost.example .env.selfhost
```

Đặt `ALLOWED_ORIGINS=https://tanthanh381.github.io`. Tailscale Funnel không cần token trong ứng dụng. Với frontend Pages, đặt `VITE_API_URL` trong biến Actions bằng hostname HTTPS public. Có thể để key AI trống khi dùng media local.

### Khóa API riêng của từng người dùng (OpenAI, Claude)

Mỗi người dùng có thể dán khóa OpenAI hoặc Claude của riêng mình ở **Cài đặt → Dịch vụ trả phí**; chi phí tính vào tài khoản của họ, không dùng khóa của máy chủ. Để bật tính năng này, đặt một chuỗi bí mật ngẫu nhiên trong `.env.selfhost`:

```bash
echo "API_KEYS_SECRET=$(openssl rand -base64 36 | tr -d '\n=+/' | cut -c1-48)" >> .env.selfhost
```

- Khóa được mã hóa AES-256-GCM (khóa mã hóa riêng cho từng người dùng, suy ra từ `API_KEYS_SECRET`) rồi lưu trong bucket Supabase **riêng tư** `app-secrets` (API tự tạo bucket ở lần lưu đầu tiên; chỉ service role đọc được). Trình duyệt chỉ nhận lại 4 ký tự cuối.
- **Hãy sao lưu `API_KEYS_SECRET`.** Nếu mất hoặc đổi giá trị, các khóa đã lưu không giải mã được và mọi người phải dán lại khóa. Để trống thì tính năng này tắt (ô dán khóa báo "máy chủ chưa bật").
- Khi lưu, máy chủ kiểm tra khóa bằng lệnh liệt kê model (miễn phí, không phát sinh chi phí). Khóa sai bị từ chối, khóa không kiểm tra được vì mạng thì không lưu.
- Khóa của người dùng được ưu tiên hơn khóa chung trong `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` (nếu có). Chức năng "Tạo video tự động" bằng một cú nhấp luôn chỉ dùng Ollama và media trên máy.
- `OPENAI_BASE_URL` và `ANTHROPIC_BASE_URL` (mặc định là địa chỉ chính thức) chỉ cần đổi khi dùng proxy hoặc khi kiểm thử.

## Cài media AI local trên macOS

Máy kiểm thử đã cài Python 3.12, MLX Stable Diffusion với cache SDXL-Turbo và model Whisper trong các thư mục bị `.gitignore`. VieNeu/Piper cung cấp giọng tiếng Việt local. Image server bật anatomy guard + negative prompt để hạn chế mặt, tay và cơ thể biến dạng; dùng `IMAGE_CFG_WEIGHT=0` nếu ưu tiên tốc độ tối đa hơn chất lượng. Đây là phần mềm/model có thể dùng miễn phí; không phát sinh API charge, nhưng thời gian tạo ảnh phụ thuộc phần cứng.

**Kích thước ảnh.** Ảnh được vẽ ở kích thước model đã được huấn luyện rồi mới co giãn ra khung video, không vẽ thẳng ở độ phân giải của video: SDXL-Turbo chỉ được chưng cất ở 512×512, vẽ lớn hơn thì người bị vẽ hai lần (xếp chồng trong khung dọc, đứng cạnh nhau trong khung ngang), thân dài bất thường, thừa tay chân. Video dọc 9:16 vẽ ở 512×896, vuông 1:1 ở 576×576, ngang 16:9 ở 768×448, 16:10 ở 704×448 (bảng `TURBO_IMAGE_SIZES` trong `local-tools/media_server.py`; có số đo ở đó). SDXL Base có bảng riêng (`BASE_IMAGE_SIZES`, dọc 704×1216) vì nó được huấn luyện ở khoảng một triệu điểm ảnh; vẽ nhỏ hơn thì nó xếp hai cảnh chồng lên nhau trong một ảnh. Vẽ ở 704×1216 chậm hơn khoảng 25% so với 576×1024.

Khởi động các tiến trình local trước khi bật worker Docker:

```bash
export LOCAL_AI_ROOT="$HOME/Developer/local-ai"
"$LOCAL_AI_ROOT/venv/bin/python" local-tools/image_server.py
LOCAL_MEDIA_HOST=127.0.0.1 /opt/homebrew/bin/python3.12 local-tools/media_server.py
# Chỉ bật sau khi có đủ text encoder local:
LTX_VIDEO_TEXT_ENCODER="$HOME/.cache/huggingface/hub/models--PixArt-alpha--PixArt-XL-2-1024-MS/snapshots/<revision>" \
  "$LOCAL_AI_ROOT/ltx-venv/bin/python" local-tools/ltx_server.py
```

Trong `.env.selfhost`:

```dotenv
LOCAL_MEDIA_BASE_URL=http://host.docker.internal:8765
LOCAL_MEDIA_FEATURES_ENABLED=true
LTX_VIDEO_URL=http://127.0.0.1:8770
```

Trong màn hình tạo video, preset ảnh local có ba mức: **Fast** (2 bước SDXL-Turbo, ưu tiên tốc độ), **Balanced** (4 bước, mặc định) và **Quality** (8 bước, ưu tiên chi tiết khuôn mặt/tay). Có thể đặt `IMAGE_PRESET=balanced` làm mặc định cho máy; lựa chọn trong từng dự án được truyền an toàn tới media bridge và không gọi API trả phí.

Cầu nối chỉ bind localhost; worker Docker truy cập qua `host.docker.internal`, không công khai endpoint media.

### Giảm một nửa dung lượng model ảnh SDXL-Turbo

Lần tạo ảnh đầu tiên tải SDXL-Turbo dạng fp32 (13,9 GB), nhưng image server luôn nạp nó dưới dạng fp16, nên một nửa dung lượng đó không bao giờ được dùng. Chạy một lần sau khi model đã tải xong (và gỡ model khỏi bộ nhớ trước: `curl -X POST localhost:5002/unload`):

```bash
"$LOCAL_AI_ROOT/wb-venv/bin/python" local-tools/slim_model_cache.py            # chuyển còn 6,9 GB
"$LOCAL_AI_ROOT/wb-venv/bin/python" local-tools/slim_model_cache.py --dry-run  # chỉ báo sẽ tiết kiệm bao nhiêu
```

Script ghi từng tensor một (không tốn RAM), kiểm tra từng tensor giống hệt `astype(float16)` rồi mới thay file cũ; kiểm tra lỗi thì giữ nguyên bản gốc. Ảnh tạo ra giống hệt từng byte (đã thử cùng seed trước và sau). Chạy lại nhiều lần vẫn an toàn.

### Máy vẽ tay (phong cách "Vẽ tay bảng trắng")

Video chọn phong cách **Vẽ tay bảng trắng** được worker gửi từng cảnh tới `local-tools/whiteboard_server.py` (cổng 8766) để bàn tay vẽ nét viền rồi tô màu. Máy này cần môi trường Python riêng và ffmpeg trong `PATH`:

```bash
/opt/homebrew/bin/python3.12 -m venv "$LOCAL_AI_ROOT/wb-venv"
"$LOCAL_AI_ROOT/wb-venv/bin/pip" install opencv-python-headless numpy Pillow
```

LaunchAgent `~/Library/LaunchAgents/com.ai-short-video.whiteboard.plist` chạy server bằng `wb-venv` khi đăng nhập và tự bật lại nếu tắt. Trạng thái hiện ở Cài đặt → "Máy vẽ tay". Khi máy này tắt, video vẽ tay báo lỗi ngay từ đầu thay vì sau khi đã tạo ảnh và giọng.

### Sửa khuôn mặt

SDXL-Turbo vẽ khuôn mặt nhỏ (khoảng 100 px) hay bị méo mắt, cong kính. Sau mỗi ảnh có người, media bridge chạy `local-tools/face_detail.py` (trong `wb-venv`): mô hình YuNet tìm khuôn mặt, từng mặt được phóng lên 512 px, vẽ lại bằng image-to-image (mức 0,42, giữ tư thế, tóc, kính, nét cười) rồi ghép lại dưới viền mờ. Cần thêm một file mô hình 232 KB:

```bash
mkdir -p "$LOCAL_AI_ROOT/models/face"
curl -fsSL -o "$LOCAL_AI_ROOT/models/face/face_detection_yunet_2023mar.onnx" \
  https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
```

Cài đặt → "Sửa khuôn mặt" cho biết bước này có chạy không và đã sửa bao nhiêu mặt; thiếu venv hoặc mô hình thì hiện rõ thiếu gì thay vì âm thầm bỏ qua. Tắt bằng `FACE_DETAIL=false` trong môi trường của media bridge. Chỉ áp dụng cho ảnh SDXL-Turbo; ảnh SDXL Base (ComfyUI) đã vẽ ở độ phân giải gốc của nó.

### Kiểm thử phần Python

`pnpm test` chạy cả test của bộ vẽ tay và bước sửa mặt (`scripts/test-local-tools.sh`, cần `wb-venv`; máy không có venv như CI sẽ bỏ qua và ghi rõ).

## Khởi động

```bash
docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml up -d --build
docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml ps
```

Kiểm tra API nội bộ tại `http://127.0.0.1:8787/health`. Sau đó đặt GitHub Actions variable `VITE_API_URL` bằng hostname HTTPS của Tailscale Funnel, hoặc `http://localhost:8787` nếu chạy local, rồi triển khai lại frontend.

Trong **Cài đặt**, nút **Kiểm tra lại** gọi `GET /v1/settings` để kiểm tra Backend API, quyền Supabase, worker render, Ollama và media server. Worker cung cấp health endpoint nội bộ tại `http://worker:8790/health`; không cần publish cổng này ra Internet. OpenAI/Claude chỉ được kiểm tra sự tồn tại của API key (khóa chung của máy chủ hoặc khóa người dùng đã lưu), không gọi API provider để tránh phát sinh chi phí. Nếu vừa sửa `.env.selfhost`, hãy rebuild/restart compose trước khi kiểm tra lại.

## Kết nối public bằng Tailscale Funnel

Tailscale Funnel chuyển tiếp riêng cổng API ra HTTPS; worker, ComfyUI và media server vẫn chỉ chạy trên máy local. Trên máy đã đăng nhập Tailscale và đã được quản trị viên cho phép Funnel:

```bash
tailscale up --accept-dns=false --accept-routes
tailscale funnel --bg --https=443 http://127.0.0.1:8787
tailscale funnel status
```

Lấy hostname HTTPS từ `tailscale funnel status`, kiểm tra `/health`, rồi đặt GitHub Actions variable `VITE_API_URL` bằng hostname đó (ví dụ `https://may-cua-ban.tailnet.ts.net`). Máy phải bật Tailscale, Docker API và worker khi sử dụng; nếu máy tắt hoặc Funnel dừng thì frontend vẫn mở được nhưng không tạo/render video.

## Dừng và cập nhật

```bash
docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml stop
git pull
docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml up -d --build
```

Không dùng `down -v` trừ khi chủ động muốn xóa volume file tạm. Media chính nằm trong Supabase Storage, không nằm trong repository.

Khi dừng hoặc dựng lại, worker làm nốt video đang tạo rồi mới thoát (tối đa 45 phút, `stop_grace_period`), nên lệnh có thể chờ lâu nếu đang có video chạy; không nhấn Ctrl+C để ép dừng. Mỗi lần dựng lại để lại image cũ không dùng tới; dọn định kỳ để ổ đĩa không đầy:

```bash
docker image prune -f
colima ssh -- sudo fstrim -a
```
