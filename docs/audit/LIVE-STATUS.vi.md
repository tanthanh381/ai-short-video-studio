# Trạng thái audit hiện tại

Ngày kiểm tra: 18/10/2026

## Kết luận

**Overall Product Score tạm thời: 61/100**

**Production Readiness: PARTIALLY READY**

Frontend đã deploy và backend self-host đã được kiểm tra bằng runtime thật; chưa thể kết luận sản phẩm READY vì chưa có bằng chứng E2E có xác thực qua trình duyệt và chưa chấm thủ công đủ 10 video theo rubric biên tập.

## Bằng chứng đã xác minh

| Hạng mục | Kết quả |
|---|---|
| Repository | `main` tại commit `c451f5e` (còn giữ 2 tài liệu nghiên cứu local chưa commit) |
| GitHub Pages | HTTP 200 |
| Live asset | `assets/index-N_9o_R-B.js` |
| Tính năng trong bundle live | Lồng tiếng, Ý tưởng, Kịch bản, giới hạn 50 MB |
| API health lịch sử | `/health` từng trả `{"ok":true,"service":"ai-short-video-studio-api"}` trên Mini |
| Self-host hiện tại | Funnel `https://mini.tail743b7a.ts.net/health` trả HTTP 200; `/v1/projects`, `/v1/videos` không token đều trả HTTP 401 |
| Commit self-host hiện tại | `c451f5e`; worker đã rebuild/restart bằng `.env.selfhost` |
| Rollout mới nhất | API và worker build thành công, container đã restart; API healthy và worker Up |
| Supabase production schema | PASS — đã áp dụng `input_mode_one_click` và `dub_video_job`; RPC overload, enum `dub_video`, bucket 50 MB đã kiểm tra bằng SQL |
| Supabase security advisor | WARN — Leaked Password Protection đang tắt; performance advisor không có finding |
| Supabase Auth public settings | PASS cấu hình — `google: true`, `email: true`, signup không bị khóa; OAuth browser E2E vẫn chưa chạy |
| Supabase runtime data | Có 6 project, 11 job, 4 export; 4 `create_video` completed, 2 failed, 1 running; chưa có job `dub_video` |
| CI/Pages | PASS cho `c451f5e`; live HTTP 200 |
| Local quality gates | Đã đạt trong lần chạy trước: typecheck, 195 test TypeScript, 15 test Python, build, audit dependency 0 advisory |
| Lint | Chưa có script lint trong project |
| FFmpeg native trên máy audit | Host thiếu filter `subtitles`; Docker worker production đã smoke PASS H.264/AAC 1080×1920, ASS UTF-8 và camera motion |

## Pipeline hiện tại

```text
USER INPUT
  → Supabase Auth + allowlist
  → Express API
  → PostgreSQL jobs
  → worker claim job
  → script/storyboard
  → ảnh local hoặc media upload
  → TTS + audio cues
  → subtitle ASS
  → FFmpeg H.264/AAC
  → private Storage + export record
  → preview/download
```

Luồng lồng tiếng video upload đã được đưa vào server-side job `dub_video`. Luồng ý tưởng/kịch bản đã có lựa chọn rõ ràng. Hai migration tương ứng đã được áp dụng trên Supabase production và kiểm tra lại bằng SQL.

Rollout self-host đã đạt điều kiện kỹ thuật tối thiểu. Tuy nhiên `/health` và auth boundary chưa chứng minh model local, migration Supabase, TTS, upload, worker job hoặc render MP4 hoạt động end-to-end.

## Phân loại chính

| Hạng mục | Trạng thái |
|---|---|
| Frontend public deploy | PASS |
| API/worker self-host production | PASS — commit `c451f5e`, API healthy, worker healthy, Funnel health 200 |
| Schema Supabase cho release | PASS — migration và các invariant chính đã xác minh |
| Upload video và lồng tiếng | PARTIAL — code, schema và UI có; dữ liệu production chưa có job `dub_video`, chưa E2E job/render trên Mini |
| Tách ý tưởng/kịch bản | PASS ở UI/API; chất lượng script AI chưa benchmark |
| TTS nghe thử/chọn giọng | PARTIAL — wiring có; chưa đánh giá giọng thật tiếng Việt/Anh/mixed |
| Signup/login Google | PARTIAL — provider Google đã bật trên production; chưa xác minh redirect, tạo session và allowlist qua browser |
| Subtitle timing/style | PARTIAL — kỹ thuật có; chưa đánh giá lệch tiếng và safe-zone trên video thật |
| Tạo video AI 10 chủ đề | PARTIAL — 10/10 MP4 benchmark đạt technical gate; chưa chấm thủ công đủ 10 video |
| Video generative motion | PARTIAL — LTX-Video 2B Distilled đã ready trên Air; smoke image-to-video 6 giây tạo MP4 có frame motion; Mini dùng camera-motion fallback |
| Auto music/SFX theo cảm xúc | NOT IMPLEMENTED |
| Quality gate kỹ thuật và content gate | PARTIAL — có gate hook/cấu trúc/minh họa, subtitle/audio/render; chưa có điểm biên tập tự động đáng tin cậy ≥80 |
| Render lại riêng segment lỗi bằng cache | NOT IMPLEMENTED |
| Cost thực 30/60/90 giây | NOT VERIFIED |
| Lint | NOT IMPLEMENTED |

## P0/P1 còn mở

| Priority | Vấn đề | Điều kiện đóng |
|---|---|---|
| P0 | Chưa có E2E authenticated | Có tài khoản QA allowlist, chạy login → project → generate → render → download → reopen |
| P1 | Chưa chấm chất lượng biên tập | Chấm đủ 10 MP4 thật theo 10 tiêu chí; technical pass không thay thế playback review |
| P1 | Chưa nghe/đánh giá TTS thực | Kiểm tra tiếng Việt, English, mixed, pause, emotion và fallback consistency |
| P1 | Chưa chứng minh retry/resume/provider failure | Worker crash/timeout/storage failure và retry giữ được scene thành công |
| P1 | Quality gate semantic còn thiếu một phần | Gate storyboard về coverage/hook/narration đã được bổ sung trong checkout audit; cần rollout và tiếp tục tách lỗi visual/voice/subtitle để regenerate đúng component |
| P1 | Leaked Password Protection đang tắt | Bật trong Supabase Auth và kiểm tra lại security advisor |

## Điều kiện cần từ máy Mini

Chạy trong đúng thư mục repo, không chạy tại `~`:

```sh
cd /đường/dẫn/tới/ai-short-video-studio
git pull origin main
git rev-parse --short HEAD
docker-compose --version
docker-compose --env-file .env.selfhost -f docker-compose.selfhost.yml up -d --build
docker-compose --env-file .env.selfhost -f docker-compose.selfhost.yml ps
curl http://127.0.0.1:8787/health
```

Nếu chỉ có `docker-compose` standalone thì dùng đúng lệnh trên. Lỗi `unknown flag: --env-file` của `docker compose` cho thấy máy đang dùng Docker CLI/Compose plugin không tương thích; đó không phải bằng chứng API mới đã chạy.

Sau khi có output `git rev-parse`, `docker-compose ps` và `/health`, mới tiếp tục được E2E và benchmark. Không gửi `.env`, service-role key hoặc mật khẩu vào chat.

Với trạng thái hiện tại, cần cập nhật Mini trước:

```sh
cd ~/ai-short-video-studio
git pull origin main
git rev-parse --short HEAD   # phải là c451f5e hoặc mới hơn
docker-compose --env-file .env.selfhost -f docker-compose.selfhost.yml up -d --build
docker-compose --env-file .env.selfhost -f docker-compose.selfhost.yml ps
```

## Quyết định readiness

Chưa đánh dấu READY. Frontend live, backend self-host, benchmark kỹ thuật và LTX smoke đã xác minh; E2E có xác thực qua trình duyệt, playback review đủ 10 video, đánh giá TTS thực và retry/resume vẫn còn thiếu.

## Benchmark cập nhật ngày 18/10/2026

Worker self-host đã tạo đủ 10 case benchmark thật bằng local pipeline; B05 được chạy lại sau khi sửa prompt và B06 được retry sau lỗi mạng tạm thời.

| Case | Kết quả kỹ thuật | Điểm biên tập |
|---|---|---|
| B01–B10 | Technical gate PASS sau khi hoàn tất retry; MP4 mở được, đúng tỷ lệ, có audio/subtitle | Chưa chấm playback |

Có **10/10 MP4 technical PASS**, nhưng chưa có điểm Hook/Script/Visual/Voice/Subtitle/Editing/Audio/Emotion/Retention/Shareability nên chưa thể tính Product Score hoặc kiểm tra mục tiêu trung bình 80/100.

Các benchmark hiện tại chạy bằng direct worker/local pipeline, vì vậy chưa thay thế được browser/API benchmark có xác thực. Cần tài khoản QA hợp lệ để chạy tiếp luồng live: đăng nhập → tạo project → tạo video → render → download → mở lại project.

## Kiểm tra bổ sung trong executor audit

| Kiểm tra | Kết quả hiện tại |
|---|---|
| Python unit tests trong `local-tools` | PASS — 15/15 |
| `git diff --check` | PASS |
| FFmpeg native có filter `subtitles` | FAIL — binary hiện tại không liệt kê filter này; không dùng làm bằng chứng render production |
| Node.js/pnpm trong executor audit | BLOCKED — không có executable trong `PATH`, nên chưa rerun được typecheck/test/build JavaScript |
| Docker daemon trong executor audit | BLOCKED — không truy cập được Colima socket; chưa dùng được Docker image để xác minh FFmpeg runtime |
| Live Pages/Funnel trong executor audit | BLOCKED — DNS/network không truy cập được; không thay thế bằng bằng chứng cũ |

Các kết quả trên chỉ cập nhật trạng thái xác minh của executor audit. Chúng không thay thế việc chạy E2E có xác thực và benchmark trên Mini self-host.

## Cải tiến chất lượng nội dung ngày 18/10/2026

Checkout audit đã bổ sung gate trước bước tạo media để chặn storyboard bỏ sót chủ đề, hook không được đọc ở scene đầu, narration không nằm trong các scene và mật độ lời đọc không phù hợp thời lượng. Prompt visual theo batch giờ nhận vị trí trong toàn bộ câu chuyện và prompt diffusion được chuẩn hóa tiếng Anh để giảm ảnh chung chung.

Các kiểm tra hiện tại đã đạt: typecheck 4/4 workspace, API 70 test, web 135 test, worker 386 test, shared 104 test, Python local-tools 18 test, production build và FFmpeg smoke H.264/AAC 1080×1920 với phụ đề ASS UTF-8 và camera motion. Project chưa có script lint.

LTX hiện chạy được trên Air; authenticated browser E2E và playback review đủ 10 video vẫn còn thiếu. Vì vậy trạng thái sản phẩm vẫn là PARTIALLY READY.
