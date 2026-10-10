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

## Thêm máy phụ (MacBook Air) để chia tải

Worker vẫn chạy một chỗ duy nhất, trên máy chính (Mac mini). MacBook Air chỉ chạy các dịch vụ AI (Ollama, vẽ ảnh, giọng đọc, Whisper, máy vẽ tay) và nhận việc từ máy chính qua Tailscale. Máy Air không cần Docker, không giữ khóa Supabase hay khóa API nào.

### Hệ thống tự quyết định thế nào

Trước mỗi đợt việc (tạo ảnh các cảnh, đọc các cảnh, vẽ tay), worker hỏi từng máy xem đang làm được gì và tốn bao lâu cho một việc, rồi tính xem cả đợt xong sớm nhất khi chạy một máy hay nhiều máy:

- Máy phụ chỉ tham gia khi làm cả đợt nhanh hơn ít nhất 15% và tiết kiệm ít nhất 30 giây. Video 2 – 3 cảnh chạy trên máy chính; video 8 cảnh trở lên thường chạy song song. Không đánh thức một chiếc laptop, làm nó nóng và hao pin chỉ để tiết kiệm vài giây.
- Mỗi máy nhận một việc một lúc, máy nào xong trước nhận việc tiếp, nên máy nhanh tự nhận nhiều hơn. Máy chậm không được giao cảnh cuối nếu máy nhanh xong cảnh đó sớm hơn.
- Thời gian một việc được đo từ chính các lần chạy trước (trung bình có trọng số), lần đầu dùng số máy đó tự báo hoặc đoán chậm hơn máy chính một chút.
- Việc đang chạy trên một máy mà máy đó mất kết nối (gập màn hình, ngủ, rớt mạng) tự được giao lại cho máy còn lại; máy lỗi được nghỉ một lúc rồi thử lại, lỗi liên tiếp thì nghỉ lâu hơn.

Máy phụ bị loại khỏi một loại việc khi:

| Tình trạng máy phụ | Cách xử lý |
| --- | --- |
| Tắt, ngủ, rớt Tailscale | Không giao việc; việc đang chạy chuyển sang máy khác |
| Có tệp tạm dừng (`scripts/Mo-May-Phu.command pause`) | Không giao việc mới |
| Chạy pin dưới `AI_NODE_MIN_BATTERY` (30%) | Không giao việc; trên mức đó vẫn nhận nhưng được tính chậm hơn |
| RAM quá tải (memory pressure critical) | Không giao vẽ ảnh, Ollama, vẽ tay (vẫn nhận giọng đọc); RAM căng thì tính chậm hơn |
| Máy đang nóng, hệ điều hành giảm xung | Tính chậm hơn |
| Đang bận việc khác (tải CPU trên 1,25 lần số nhân) | Tính chậm hơn, tối đa 2,5 lần |
| Cấu hình ảnh/giọng hoặc mã khác máy chính | Không giao vẽ ảnh và giọng đọc, để ảnh và giọng cả video đồng nhất |
| Thiếu model ảnh, giọng hoặc model Ollama giống máy chính | Không giao loại việc đó |

Ollama (viết kịch bản, chia cảnh) chạy trọn một giai đoạn trên một máy: máy tốt nhất lúc đó, thường là máy chính. Nếu máy đó mất kết nối giữa chừng, giai đoạn được chạy lại trên máy kia. Dựng video bằng FFmpeg vẫn ở máy chính; riêng cảnh "Vẽ tay bảng trắng" được chia theo cảnh giữa các máy.

### Chuẩn bị máy Air (một lần)

1. Cài Tailscale, đăng nhập cùng tài khoản với Mac mini. Lấy địa chỉ bằng `tailscale ip -4` (dạng `100.x.y.z`). Dùng địa chỉ này, không dùng tên `.local`: container Docker trên máy chính không phân giải được tên mDNS.
2. Cài Homebrew, `python@3.12`, `ffmpeg`, `ollama`; clone repository này; chạy `ollama pull qwen3.5:4b`.
3. Đưa thư mục `local-ai` sang máy Air, cùng đường dẫn (`~/Developer/local-ai`): model SDXL-Turbo, Whisper, VieNeu, Piper, các script `bin/start-*.sh` và các môi trường Python `venv`, `wb-venv`. Cách chắc nhất khi hai máy cùng tên người dùng macOS là sao chép nguyên thư mục từ máy mini, ví dụ `rsync -a mini:Developer/local-ai/ ~/Developer/local-ai/`; môi trường Python gắn với đường dẫn nên khác tên người dùng thì phải dựng lại từng môi trường. Các thư mục này không nằm trong repository. Nhấp đúp `scripts/Kiem-Ke-May.command` trên máy mini để xem thư mục đó gồm những gì và nặng bao nhiêu (tệp chỉ đọc, không đổi gì, không in khóa hay token).
4. Máy Air cần đủ RAM cho SDXL-Turbo (model fp16 chiếm khoảng 7 GB); máy 8 GB sẽ bị hệ thống báo RAM căng và chậm, nên nên để máy chính làm phần việc đó.
5. Chạy `scripts/Mo-May-Phu.command`. Script lấy địa chỉ Tailscale, sinh token một lần và lưu ở `~/.studio-node-token`, rồi mở các cổng 8765 (media), 8766 (máy vẽ tay) và 11434 (Ollama) chỉ trên địa chỉ Tailscale, không mở `0.0.0.0`. Media bridge và máy vẽ tay từ chối khởi động nếu bị mở ra mạng mà không có `NODE_TOKEN`. Ollama không có cơ chế token, nên chỉ cho phép máy mini truy cập cổng 11434 của máy Air bằng ACL của Tailscale nếu tailnet có nhiều thiết bị.

### Kết nối từ máy chính

Trong `.env.selfhost` trên máy mini:

```dotenv
AI_NODES=air=100.101.102.103
AI_NODES_TOKEN=<nội dung ~/.studio-node-token trên máy Air>
```

Rồi dựng lại worker và kiểm tra:

```bash
docker-compose --env-file .env.selfhost -f docker-compose.selfhost.yml up -d --build worker
scripts/kiem-tra-may.sh
```

Script cho biết từng máy đang sẵn sàng, hạn chế (vì sao) hay mất kết nối, thời gian trung bình mỗi việc và quyết định phân việc gần nhất. Trang **Cài đặt** của website có mục "Máy cùng xử lý video" với cùng thông tin. Khi tạo video, dòng trạng thái ghi máy đang vẽ từng cảnh.

### Giữ hai máy đồng bộ

Sau mỗi lần `git pull`, khởi động lại image server (cổng 5002) và media bridge (cổng 8765) ở cả hai máy, vì hai tiến trình này đang chạy mã cũ cho tới khi được khởi động lại. Media bridge tính một dấu vân tay từ các thông số ảnh/giọng (`IMAGE_STEPS`, `VIENEU_STEPS`, `TTS_BREAK_WORDS`, voice, negative prompt...) và từ mã `media_server.py`, `image_server.py`. Hai máy khác dấu vân tay thì máy phụ không nhận vẽ ảnh và giọng đọc, và Cài đặt ghi rõ lý do. Chỉ đặt `AI_NODES_STRICT=false` khi chấp nhận ảnh hai máy có thể khác nhau.

### Điều khiển

- Tạm dừng khi cần dùng máy Air: `scripts/Mo-May-Phu.command pause`; nhận việc lại: `scripts/Mo-May-Phu.command resume`.
- `AI_BALANCE_MODE=auto` (mặc định) để hệ thống tự quyết định; `single` chỉ dùng máy chính và giữ máy phụ làm dự phòng; `parallel` luôn dùng mọi máy khả dụng.
- Máy Air nên cắm sạc, không gập màn hình khi đang phục vụ. Script dùng `caffeinate` để máy không ngủ, nhưng không ngăn được việc gập màn hình khi không có màn hình ngoài.
- Bỏ dòng `AI_NODES` rồi dựng lại worker để quay về một máy: worker khi đó không thăm dò và không gọi máy nào ngoài máy chính.

### Giới hạn hiện tại

- Chưa dựng FFmpeg trên máy phụ: bước ghép MP4 vẫn chạy ở máy chính.
- Mỗi máy làm một việc ảnh và một việc giọng cùng lúc, như trước đây trên máy mini.
- Cùng seed nhưng khác đời chip Apple Silicon có thể cho ảnh khác nhau ở chi tiết nhỏ.
- Các quy tắc đọc tình trạng máy (pin, nhiệt, RAM) dựa trên `pmset` và `sysctl` của macOS và đã được kiểm thử bằng mẫu đầu ra; chưa chạy thử trên phần cứng MacBook Air thật.

## Dừng và cập nhật

Cách nhanh nhất để cập nhật máy chính: nhấp đúp `scripts/Cap-Nhat-May-Chinh.command`. Tệp này hỏi lại xem có video nào đang tạo không, tải bản mới từ GitHub, dựng lại API và worker, khởi động lại máy vẽ ảnh và cầu nối media, rồi tự kiểm tra và báo kết quả. Phần dưới là các lệnh tương đương nếu muốn làm tay.

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
