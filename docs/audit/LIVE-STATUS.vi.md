# Trạng thái audit hiện tại

Ngày kiểm tra: 06/10/2026

## Kết luận

**Overall Product Score tạm thời: 61/100**

**Production Readiness: PARTIALLY READY**

Frontend đã deploy và có các luồng mới trong bundle live. Backend self-host và schema production đã được xác minh sau rollout; chưa thể kết luận sản phẩm READY vì chưa có bằng chứng E2E có xác thực: đăng nhập thật, tạo video bằng model thật, worker xử lý job, render MP4 và chạy đủ 10 video benchmark.

## Bằng chứng đã xác minh

| Hạng mục | Kết quả |
|---|---|
| Repository | `main` sạch tại commit `e1568cd` |
| GitHub Pages | HTTP 200 |
| Live asset | `assets/index-N_9o_R-B.js` |
| Tính năng trong bundle live | Lồng tiếng, Ý tưởng, Kịch bản, giới hạn 50 MB |
| API health lịch sử | `/health` từng trả `{"ok":true,"service":"ai-short-video-studio-api"}` trên Mini |
| Self-host hiện tại | Funnel `https://mini.tail743b7a.ts.net/health` trả HTTP 200; `/v1/projects`, `/v1/videos` không token đều trả HTTP 401 |
| Commit self-host hiện tại | `e1568cd` |
| Rollout mới nhất | API và worker build thành công, container đã restart; API healthy và worker Up |
| Supabase production schema | PASS — đã áp dụng `input_mode_one_click` và `dub_video_job`; RPC overload, enum `dub_video`, bucket 50 MB đã kiểm tra bằng SQL |
| Supabase security advisor | WARN — Leaked Password Protection đang tắt; performance advisor không có finding |
| Supabase Auth public settings | PASS cấu hình — `google: true`, `email: true`, signup không bị khóa; OAuth browser E2E vẫn chưa chạy |
| Supabase runtime data | Có 6 project, 11 job, 4 export; 4 `create_video` completed, 2 failed, 1 running; chưa có job `dub_video` |
| CI/Pages | Đã có bằng chứng workflow thành công cho `e1568cd` |
| Local quality gates | Đã đạt trong lần chạy trước: typecheck, 195 test TypeScript, 15 test Python, build, audit dependency 0 advisory |
| Lint | Chưa có script lint trong project |
| FFmpeg native trên máy audit | Smoke render không chạy được vì FFmpeg Homebrew thiếu filter `subtitles`; Docker image vẫn cần xác minh trên Mini |

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
| API/worker self-host production | PASS — commit `e1568cd`, API healthy, worker Up, Funnel health 200 |
| Schema Supabase cho release | PASS — migration và các invariant chính đã xác minh |
| Upload video và lồng tiếng | PARTIAL — code, schema và UI có; dữ liệu production chưa có job `dub_video`, chưa E2E job/render trên Mini |
| Tách ý tưởng/kịch bản | PASS ở UI/API; chất lượng script AI chưa benchmark |
| TTS nghe thử/chọn giọng | PARTIAL — wiring có; chưa đánh giá giọng thật tiếng Việt/Anh/mixed |
| Signup/login Google | PARTIAL — provider Google đã bật trên production; chưa xác minh redirect, tạo session và allowlist qua browser |
| Subtitle timing/style | PARTIAL — kỹ thuật có; chưa đánh giá lệch tiếng và safe-zone trên video thật |
| Tạo video AI 10 chủ đề | NOT VERIFIED — benchmark thực tế 0/10 |
| Video generative motion | NOT IMPLEMENTED — hiện chủ yếu ảnh tĩnh + camera motion |
| Auto music/SFX theo cảm xúc | NOT IMPLEMENTED |
| Quality gate ≥80 và tự regenerate component lỗi | NOT IMPLEMENTED đầy đủ |
| Render lại riêng segment lỗi bằng cache | NOT IMPLEMENTED |
| Cost thực 30/60/90 giây | NOT VERIFIED |
| Lint | NOT IMPLEMENTED |

## P0/P1 còn mở

| Priority | Vấn đề | Điều kiện đóng |
|---|---|---|
| P0 | Chưa có E2E authenticated | Có tài khoản QA allowlist, chạy login → project → generate → render → download → reopen |
| P1 | Chưa chứng minh chất lượng video | Tạo đủ 10 MP4 thật, chấm 10 tiêu chí, đạt trung bình ≥80 và hook ≥8 |
| P1 | Chưa nghe/đánh giá TTS thực | Kiểm tra tiếng Việt, English, mixed, pause, emotion và fallback consistency |
| P1 | Chưa chứng minh retry/resume/provider failure | Worker crash/timeout/storage failure và retry giữ được scene thành công |
| P1 | Quality gate semantic chưa có | Tách lỗi hook/visual/voice/subtitle và regenerate đúng component |
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
git rev-parse --short HEAD   # phải là e1568cd hoặc mới hơn
docker-compose --env-file .env.selfhost -f docker-compose.selfhost.yml up -d --build
docker-compose --env-file .env.selfhost -f docker-compose.selfhost.yml ps
```

## Quyết định readiness

Chưa đánh dấu READY. Frontend live, backend self-host và migration production đã xác minh; E2E có xác thực, video AI thực, benchmark và một cảnh báo Auth vẫn là các điều kiện bắt buộc còn thiếu.

## Benchmark cập nhật từ Mini

Ngày 06/10/2026, sau khi giải phóng khoảng 2,211 GB Docker space, runner đã tải thành công:

| Case | Kết quả kỹ thuật | Điểm biên tập |
|---|---|---|
| B01 | Đã tải từ lượt trước; technical=true | Chưa chấm |
| B02 | downloaded; technical=true | Chưa chấm |
| B03 | downloaded; technical=true | Chưa chấm |
| B04 | downloaded; technical=true | Chưa chấm |
| B05 | downloaded; technical=true | Chưa chấm |
| B06 | Dừng khi đọc jobs với HTTP 401 | Chưa chấm |
| B07–B10 | Chưa chạy | Chưa chấm |

Tạm thời có **5/10 MP4 technical PASS**, nhưng chưa có điểm Hook/Script/Visual/Voice/Subtitle/Editing/Audio/Emotion/Retention/Shareability nên chưa thể tính Product Score hoặc kiểm tra mục tiêu trung bình 80/100.

HTTP 401 tại `/v1/projects/72088676-6239-49db-8df8-6dbc784b0a4a/jobs` cho thấy access token benchmark không còn được API chấp nhận tại thời điểm polling (thường là hết hạn hoặc phiên không còn hợp lệ). Đây không phải lỗi tạo video B02–B05. Cần dùng access token QA mới rồi chạy tiếp journal hiện có; không xóa `tmp/audit-benchmarks/state.json` và không tạo lại project B01–B05.

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
