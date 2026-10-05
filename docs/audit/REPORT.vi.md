# Báo cáo audit và tối ưu AI Short Video Studio

Ngày kiểm tra: 05/10/2026. Phạm vi: mã nguồn, kiểm thử tự động, giao diện chưa đăng nhập, API đọc công khai và renderer thực với tài sản tổng hợp.

## 1. Kết luận điều hành

**Overall Product Score: CHƯA CHẤM /100.** Chưa đủ bằng chứng của luồng có đăng nhập và video AI thực để quy đổi thành một điểm sản phẩm đáng tin cậy.

**Production Readiness: NOT READY đối với mục tiêu “nhập ý tưởng → video hấp dẫn, đăng ngay, không chỉnh sửa ngoài”.** Kết luận này không có nghĩa mọi chức năng đều hỏng: build, unit/integration tests, renderer và các kiểm soát được nêu dưới đây đã được chạy và có bằng chứng. Các năng lực sáng tạo và E2E còn thiếu hoặc chưa được nghiệm thu.

**Video AI benchmark đã tạo qua hệ thống: 0/10.** Không có phiên người dùng QA hợp lệ được allowlist để chạy pipeline sau đăng nhập. Không lấy khóa service-role để giả lập quyền người dùng, không thay đổi allowlist và không gửi thông tin xác thực vào repository. Video kỹ thuật dùng hình và tín hiệu âm thanh tổng hợp KHÔNG thay thế 10 video benchmark AI.

Đã sửa mã nguồn trong **Draft PR #1**, nhánh `audit/2026-10-05-product-hardening`. Chưa merge, chưa deploy frontend/API/worker, chưa áp dụng migration trên Supabase production. Không đổi framework hoặc xây dựng lại ứng dụng.

## 2. Nguồn và bằng chứng

- Website: https://tanthanh381.github.io/ai-short-video-studio/
- Repository: https://github.com/tanthanh381/ai-short-video-studio
- PR: https://github.com/tanthanh381/ai-short-video-studio/pull/1
- Mã nguồn gốc: `69662eab43fc26688dcfc4a1d333faa8d1b72fc0`.
- Commit bản sửa runtime đã kiểm tra: `d03e03f48743643edc517fbb5ca7c30c75a1757f`.
- Commit bộ regression mở rộng: `631c7d6617e49bcd30013e26496ec2056f439e32`.
- Baseline: https://github.com/tanthanh381/ai-short-video-studio/actions/runs/37285651503
- Runtime verification: https://github.com/tanthanh381/ai-short-video-studio/actions/runs/37286777951
- Final regression và SQL: https://github.com/tanthanh381/ai-short-video-studio/actions/runs/37287760383

Artifact baseline có `tests.log`, `python.log`, `typecheck.log`, `build.log`, `dependency-audit.json`, `live-smoke.json` và ảnh chụp website. Artifact final có các log tương ứng, `browser.json`, `audio.log`, `render.log`, `first-frame.json`, MP4 kỹ thuật và ảnh chụp giao diện. Artifact database có `database.log`. Các file này cho phép phân biệt quan sát thực với nhận định từ mã nguồn.

## 3. Kiến trúc và pipeline hiện tại

| Thành phần | Hiện trạng trong mã nguồn |
|---|---|
| Frontend | React + TypeScript + Vite; GitHub Pages; các trang login, reset-password, dashboard, new, studio, media, exports, settings. |
| API | Express/Node; xác thực Bearer qua Supabase, kiểm tra allowed_users; CORS, Helmet, Pino và rate limit. Cấu hình triển khai tự host có Docker/Tailscale. |
| Database | Supabase PostgreSQL: allowed_users, projects, scenes, jobs, exports, usage_events; RPC cho enqueue, save và claim job. |
| Authentication | Password, magic link, reset password; sản phẩm kiểu studio riêng có allowlist, không có màn hình đăng ký công khai. |
| LLM | Mặc định Ollama qwen2.5:3b; có adapter Anthropic/OpenAI. Có adapter không đồng nghĩa provider/model thực tế đã được xác minh hoạt động. |
| Ảnh | Luồng local hiện tại: SDXL-Turbo qua MLX; image_server.py mặc định 2 bước. Không nên dùng mô tả ComfyUI/AnalogDiffusion cũ trong tài liệu để kết luận runtime hiện tại. |
| Giọng nói | Bridge local có VieNeu, Piper và macOS say/Linh; đường mặc định có fallback. Lựa chọn model tường minh có hành vi khác với fallback mặc định. |
| Phụ đề | Cues theo các đoạn PCM đã đo; có Whisper.cpp dự phòng. Phụ đề được ghi ASS UTF-8 và burn-in bằng FFmpeg. Đường Whisper local đặt ngôn ngữ vi. |
| Video | Ảnh tĩnh được scale/crop/zoom-pan, ghép cảnh; chưa có engine tạo chuyển động video bằng generative AI. |
| Nhạc/SFX | Nhạc tải lên thủ công; chưa có tự chọn nhạc/SFX theo cảm xúc. Bản sửa thêm ducking và limiter. |
| Render/storage | FFmpeg H.264 + AAC, MP4 faststart; private Supabase Storage và URL có chữ ký cho preview/download. |
| Background jobs | Worker nhận việc từ PostgreSQL, có progress, heartbeat, retry và checkpoint; không phải render hoàn toàn trong trình duyệt. |
| Observability | Pino, trạng thái job, usage_events; chưa có đầy đủ tracing từng công đoạn, p50/p95, sổ chi phí thực và analytics retention. |

Pipeline một nút được xác định từ `apps/api/src/app.ts`, `apps/worker/src/index.ts`, `providers.ts`, `pipeline.ts`, `render.ts` và `local-tools/*`:

```text
USER INPUT
  → API xác thực + allowlist + validation + idempotency
  → PostgreSQL enqueue / worker claim
  → giữ kịch bản đầy đủ, chia narration thành các cảnh
  → Ollama sinh storyboard/visual prompt
  → ảnh SDXL-Turbo theo cảnh
  → giọng đọc local + cues / Whisper dự phòng
  → nhạc tải lên nếu có
  → FFmpeg segment → concat → ASS → H.264/AAC
  → upload MP4/thumbnail → export record
  → preview / signed download
```

**Khoảng cách lớn nhất với mục tiêu:** luồng một nút hiện buộc `full-script`, không tự coi câu ý tưởng ngắn là yêu cầu viết câu chuyện hoàn chỉnh. Nhánh xử lý `idea` có trong một số đường code, nhưng không phải hành vi đã được chứng minh của luồng mặc định. `targetDurationSec` không phải bằng chứng video cuối đúng thời lượng; thời lượng cuối phụ thuộc giọng đọc thực.

## 4. Phân loại tính năng và giới hạn kiểm thử

PASS dưới đây chỉ áp dụng cho đúng phạm vi đã chạy. NOT TESTED được bổ sung để tránh biến việc chưa kiểm tra thành PASS hoặc FAIL. PARTIAL mô tả mức hoàn thiện từ mã nguồn, không chứng nhận E2E production.

| Tính năng | Trạng thái | Bằng chứng / phần còn thiếu |
|---|---|---|
| Tải trang và tài nguyên | PASS | Trình duyệt thật trên website công khai; không ghi nhận page exception trong lần kiểm tra. |
| Form đăng nhập mobile | UX ISSUE → PASS trong bản sửa | Ảnh baseline có hero đẩy form xuống dưới màn hình; bản sửa email ở y=388,5px trên viewport 390×844. |
| Email sai định dạng | PASS | Kiểm thử validation HTML trên form. Không thay cho kiểm thử Supabase Auth. |
| Password/magic link/reset | NOT TESTED E2E | Có UI/code; chưa dùng tài khoản thật, chưa thử email và link recovery. |
| Đăng ký công khai | NOT IMPLEMENTED | Thiết kế hiện tại dùng allowlist; cần quyết định sản phẩm trước khi mở signup. |
| Truy cập route cần đăng nhập | PASS, phạm vi logged-out | Chuyển về login; refresh không gây page exception. |
| API health / truy cập projects chưa xác thực | PASS | GET /health = 200; GET /v1/projects không token = 401. Health không chứng minh model/worker/database đều khỏe. |
| Tạo project, generate, preview, tải, mở lại sau đăng nhập | NOT TESTED E2E | Có code và một số test API giả lập, chưa chạy chuỗi thao tác bằng phiên QA. |
| Ý tưởng ngắn → kịch bản hoàn chỉnh | PARTIAL / khoảng trống P1 | Luồng một nút giữ nguyên full-script. |
| Chia kịch bản / storyboard | PARTIAL | Có validation và test; chưa đánh giá LLM thật, hook và độ liên quan ảnh. |
| Tạo ảnh local / đồng nhất nhân vật | PARTIAL | Có adapter; thiếu semantic QA và kiểm soát nhất quán xuyên cảnh. |
| Tạo video chuyển động AI | NOT IMPLEMENTED | Hiện dùng ảnh tĩnh có chuyển động camera. |
| Tiếng Việt / English / mixed | PARTIAL | Validation chấp nhận; chưa kiểm tra phát âm, language routing, giọng đọc thực. Whisper local cố định vi. |
| Phụ đề UTF-8 / timestamp | PASS kỹ thuật + PARTIAL sản phẩm | Render fixture đạt; bản sửa chặn cues sai. Chưa có keyword highlight/face-aware positioning/đo lệch voice thực. |
| Nhạc theo cảm xúc / SFX tự động | NOT IMPLEMENTED | Có thể tải nhạc thủ công; chưa có thư viện và lựa chọn tự động có kiểm soát quyền sử dụng. |
| Ducking / limiter | PASS kỹ thuật trong bản sửa | Đo tín hiệu thực bằng FFmpeg, không chỉ kiểm tra chuỗi filter. |
| Retry media theo scene | PARTIAL | Có checkpoint và giữ media đã thành công; chưa chaos-test provider lỗi và khởi động lại worker thật. |
| Render lại riêng segment lỗi | NOT IMPLEMENTED | Renderer vẫn encode lại các segment; chưa có cache segment bền vững theo fingerprint. |
| Regenerate riêng ảnh/voice/subtitle | PARTIAL | Có thao tác scene nhưng chưa có đồ thị phụ thuộc và sửa tự động từng thành phần đầy đủ. |
| Cost/video thực | PARTIAL | Estimate dùng hệ số cố định, chưa đo token, thời gian máy và storage thực. |
| Quality gate ≥80/100 + tự sửa | NOT IMPLEMENTED | Bản sửa chỉ thêm một phần gate kỹ thuật; không có semantic quality evaluator đã hiệu chuẩn. |
| Lint | NOT IMPLEMENTED | Chưa có script lint; typecheck và git diff --check không được coi là lint. |
| Dead code | CHƯA XÁC NHẬN | Adapter legacy/non-default và tài liệu cũ không tự động được coi là dead code. |

Các đường sâu GitHub Pages có phản hồi 404 ban đầu rồi SPA redirect về login. Không quy kết đây là lỗi trắng trang: kiểm thử đã quan sát ứng dụng xuất hiện. Link recovery thực vẫn cần kiểm tra với session hợp lệ.

## 5. Top issues, mức ưu tiên và xử lý

| Priority | Issue | Impact | Fix / trạng thái |
|---|---|---|---|
| P0 | Vai trò authenticated được ghi trực tiếp projects/scenes ngoài API | Có thể bỏ qua allowlist, active-job guard và optimistic locking cho dữ liệu của chính người đó | Đã tái hiện trong PostgreSQL cô lập; thêm migration thu hồi DML từ trình duyệt. Chưa xác minh/applied production. Không có bằng chứng đọc chéo tenant. |
| P0, cần phân loại khả năng khai thác | 27 dependency advisories ở baseline | Rủi ro phụ thuộc đường code/deployment, có cả công cụ dev và server | Cập nhật lockfile: snapshot còn 0 advisory. Không đồng nghĩa đã hoàn thành pentest hoặc có 27 lỗ hổng production khai thác được. |
| P1 | Luồng một nút không phân biệt idea/full-script | Ý tưởng ngắn có thể chỉ thành video đọc lại câu ngắn | Chưa sửa sản phẩm; cần chế độ rõ ràng và bảo toàn script khi người dùng yêu cầu. |
| P1 | Fade qua đen ở mọi cảnh, kể cả mở đầu | Mất khung hình đầu và nhịp kể chuyện | Đã bỏ fade mặc định, dùng straight cut giữ timeline. |
| P1 | Nhạc không duck theo voice; limiter thiếu ở đường không nhạc | Giọng có thể bị lấn hoặc quá ngưỡng | Đã sửa và đo thực với tín hiệu tổng hợp. Chưa chuẩn hóa loudness toàn pipeline. |
| P1 | Cues thiếu/sai/overlap có thể lọt đến render | Phụ đề lỗi hoặc lệch timeline | Đã thêm validation theo duration đo. Chưa tự tạo lại cues lỗi. |
| P1 | Fallback TTS có thể đổi engine/giọng giữa các đoạn | Nguy cơ không nhất quán giọng và cảm xúc | Cần cố định engine/voice cho project, log engine thực, thử nghe tiếng Việt. Chưa xác nhận lỗi giọng ở video thực. |
| P1 | Chưa có semantic QA cho hook/visual/voice | Render thành công nhưng chưa đủ căn cứ đăng trực tiếp | Cần benchmark người đánh giá + evaluator có rubric, không tự phong điểm 80. |
| P1 | Thiếu cache segment; regenerate_scene chưa tách đủ component | Tốn thời gian và compute khi sửa nhỏ | Cần cache theo image/audio/subtitle/render-settings hash và đồ thị phụ thuộc. |
| P1 | Một số đường job/budget legacy chưa có reservation nguyên tử đầy đủ | Nguy cơ race/quota vượt khi mở provider trả phí | Giữ paid path tắt cho tới khi thêm admission control/usage thực và test concurrency. |
| P2 | Form mobile dưới màn hình đầu | Tăng thao tác, dễ hiểu nhầm không có login | Đã sửa responsive override và browser regression. |
| P2 | Narration chars bị cộng cả source và scenes | Estimate TTS cao sai | Đã sửa và thêm 3 regression tests. |
| P2 | Processing serial, double encode, thiếu timeouts/phân tích p95 đầy đủ | Khó biết bottleneck và phát hiện job treo | Cần đo từng stage trên Mac thực trước khi tăng concurrency; không bật vô hạn trên máy ít RAM. |
| P2 | README khác pipeline ảnh/voice hiện tại | Người vận hành cài sai dependency hoặc kỳ vọng sai | Cần cập nhật tài liệu theo adapter thực. |
| P3 | Thiếu A/B hook, brand kit, scheduled publishing | Hạn chế workflow nâng cao | Chỉ làm sau khi chất lượng nền và reliability được nghiệm thu. |

Migration mới giữ quyền owner-read và quyền service_role của API/worker. Không xóa dữ liệu. Vì thay đổi quyền có thể ảnh hưởng client ngoài repo, cần xác nhận mọi luồng ghi đi qua API trước khi áp dụng production.

## 6. Kiểm thử đầu vào

Đã thêm và chạy kiểm thử schema cho câu ngắn hợp lệ, đoạn dài, script nhiều dòng, tiếng Việt, English, mixed language và nội dung mơ hồ: dữ liệu được chấp nhận và giữ nguyên. Đã kiểm tra từ chối chuỗi rỗng, toàn khoảng trắng, quá ngắn, quá 30.000 ký tự và sai kiểu dữ liệu. Tổng cộng 14 test mới.

Đây là **validation test**, không phải 14 video thành công. Chấp nhận tiếng Anh không chứng minh TTS đọc đúng tiếng Anh. Chấp nhận đầu vào mơ hồ không chứng minh hệ thống hiểu ý. Cần đồng nhất giới hạn API/frontend và giới hạn từ của worker để tránh nhận yêu cầu rồi mới báo lỗi muộn.

## 7. Video benchmark

Đã chuẩn bị `docs/audit/benchmark-corpus.json` và `scripts/audit/run-benchmarks.mjs`. Chế độ plan đã chạy, xác nhận đủ 10 case hợp lệ và `createdVideos: 0`. Runner chỉ gọi API khi có cờ --run, xác nhận tạo 10 video local và JWT người dùng QA hợp lệ. Có journal/idempotency để quan sát tiếp job cũ thay vì tạo project trùng; tải MP4 và ffprobe; điểm nội dung luôn để null chờ đánh giá.

| Video | Chủ đề | Hook | Visual | Voice | Retention | Total | Trạng thái |
|---|---|---|---|---|---|---|---|
| B01 | Triết lý | N/A | N/A | N/A | N/A | N/A | Chưa tạo |
| B02 | Motivation | N/A | N/A | N/A | N/A | N/A | Chưa tạo |
| B03 | Storytelling | N/A | N/A | N/A | N/A | N/A | Chưa tạo |
| B04 | Kiến thức | N/A | N/A | N/A | N/A | N/A | Chưa tạo |
| B05 | Công nghệ | N/A | N/A | N/A | N/A | N/A | Chưa tạo |
| B06 | Tài chính | N/A | N/A | N/A | N/A | N/A | Chưa tạo |
| B07 | Psychology | N/A | N/A | N/A | N/A | N/A | Chưa tạo |
| B08 | Cybersecurity | N/A | N/A | N/A | N/A | N/A | Chưa tạo |
| B09 | Productivity | N/A | N/A | N/A | N/A | N/A | Chưa tạo |
| B10 | Mystery | N/A | N/A | N/A | N/A | N/A | Chưa tạo |

N/A không phải 0 điểm. Chưa có số trung bình hoặc tỷ lệ đạt 80/100. Ten-criteria rubric vẫn phải gồm hook, script, visual, voice, subtitle, editing, audio, emotion, retention, shareability. Retention/shareability đánh giá trước đăng là dự đoán biên tập, không phải số liệu người xem.

Bộ corpus giữ nguyên kịch bản, cấu hình targetDurationSec=30 để thử đường cấu hình; đây không phải cam kết mỗi kịch bản sẽ được đọc hết trong 30 giây. Cần đo thời lượng thực và lập thêm các lượt 60/90 giây trước khi nghiệm thu kiểm soát thời lượng.

## 8. Nguy cơ drop-off và quality gate đề xuất

Chưa có analytics hoặc video AI thực nên các nội dung sau là **giả thuyết cần kiểm chứng**, không phải đường cong retention đo được.

| Mốc | Nguy cơ từ thiết kế hiện tại | Kiểm tra / cải tiến cần làm |
|---|---|---|
| 0–3s | Hook chỉ là đầu script; baseline fade từ đen | Frame0 đã sửa. Cần hook có lời hứa/căng thẳng rõ, đọc vừa 3 giây và ảnh mở đầu đúng nội dung. |
| 3–10s | Ảnh tĩnh chung chung, chưa tạo xung đột/mục tiêu | Kiểm tra tính liên quan narration, chuyển cảnh theo ý chứ không theo số từ máy móc. |
| 10–20s | Zoom-pan lặp, thiếu biến đổi thị giác | Đổi cỡ cảnh, chủ thể và nhịp; kiểm tra hình trùng và nhất quán nhân vật. |
| 20–40s | Đọc theo chunk có thể làm giọng đều hoặc ngắt ý | Nghe TTS thật, kiểm tra prosody, pause và chuyển giọng fallback. |
| 40–60s | Ý lặp, thiếu payoff hoặc ending đáng nhớ | Biên tập kết thúc, loại câu lặp; không ép CTA vào mọi chủ đề. |

Gate nên có hai tầng. **Tầng kỹ thuật**: MP4 giải mã được, H.264/AAC/9:16 theo preset, duration hợp lý, không lỗi khung hình/timestamp, caption đọc được, loudness/peak/sync đạt ngưỡng đã định nghĩa. **Tầng nội dung**: 10 tiêu chí tổng ≥80, hook ≥8, không có lỗi nghiêm trọng về phát âm, hình sai, thông tin bịa hoặc quyền sử dụng.

Nếu hook yếu: chỉ viết lại hook trong chế độ idea hoặc khi được phép sửa script; nếu ảnh yếu: chỉ tạo lại ảnh scene; voice lỗi: tạo lại voice và cập nhật cues phụ thuộc; subtitle lỗi: chỉ align/render phụ đề. Không tái sử dụng timestamp cũ sau khi thay audio. Giới hạn retry và chi phí; không âm thầm xuất bản đầu ra chưa đạt. Cần cache render theo fingerprint để phần “chỉ sửa thành phần lỗi” thực sự tiết kiệm compute.

## 9. Before vs After và kết quả thực nghiệm

| Metric | Before | After | Ý nghĩa |
|---|---|---|---|
| TypeScript tests | 114 pass | 146 pass | +32 regression tests; không coi số test là độ bao phủ toàn sản phẩm. |
| Python tests | 9 pass | 9 pass | Giữ nguyên kết quả đạt. |
| Typecheck / build | Pass | Pass | Không đổi framework. |
| Lint | Chưa có | Chưa có | Không tuyên bố lint pass. |
| Dependency advisory snapshot | 27: 1 critical, 12 high, 14 moderate | 0 | Là kết quả tại thời điểm quét, không chứng nhận hết mọi lỗ hổng. |
| Khung hình đầu cùng fixture | Đen; 100% pixel gần đen | Không đen; 0% pixel gần đen | Đo maxRGB<20 trên cùng tài sản tổng hợp, không kết luận mọi cảnh tối nghệ thuật là lỗi. |
| Ducking trên tín hiệu tổng hợp | Khoảng 0 dB | -16,47 dB khi voice hoạt động | Đã đo âm thanh FFmpeg thực, không phải điểm chất lượng TTS. |
| Timeline phép thử audio | 6 giây | 6 giây | Giảm nhạc không làm ngắn giọng. |
| Limiter không có nhạc | Chưa lọc limiter ở đường này | Sample peak 0,95 trong phép thử | Chưa phải kiểm chứng true-peak của mọi MP4 sau AAC. |
| Ghi trực tiếp bảng từ authenticated | Tái hiện được trên SQL baseline | Insert/update/delete bị chặn | Owner-read và service_role-write vẫn đạt trong database cô lập. |
| Form mobile | Dưới màn hình đầu | Email y=388,5px, cao43px trong 844px | Browser test + screenshot. |
| TTS estimate khi có scenes | Cộng source + scene narration | Chỉ scene narration | Không đếm đôi. |
| Video AI benchmark thực | Chưa có | 0/10 | Không có bằng chứng cải thiện điểm nội dung. |

FFmpeg smoke trong CI tạo MP4 4 giây, 1080×1920, H.264/AAC, phụ đề ASS UTF-8. Phép so sánh cục bộ tạo hai MP4 4,4 giây trước/sau từ cùng ảnh và audio. Đây là kiểm thử renderer thực; không dùng để chấm cinematic, emotion hoặc shareability.

Thời gian render một lần cục bộ là 5.130ms trước và 4.514ms sau. n=1, fixture rất ngắn và không chạy trên Mac production; **không suy ra mức cải thiện hiệu năng ổn định hay thời gian sản xuất video 30/60/90 giây**.

Bộ SQL chạy PostgreSQL 16 cô lập với auth/storage stubs tối thiểu. Đã chạy các migration gốc, tái hiện direct-write bypass, áp dụng migration mới, kiểm tra quyền trước/sau và bộ pipeline_regressions.sql có sẵn. Không đồng nhất kết quả này với kiểm thử đầy đủ dịch vụ Supabase production.

## 10. Reliability, performance và chi phí

Mã nguồn có checkpoint theo stage, lưu media từng scene, retry có backoff, heartbeat và reclaim job stale. Điều này tốt hơn việc chạy mọi thứ trong tab browser. Tuy nhiên vẫn cần thử worker crash, lease hết hạn, provider timeout, database/storage lỗi và refresh khi đang tạo video bằng hạ tầng thật. Chưa có kết quả chaos test production.

Bottleneck dự kiến là model local, TTS và render nhiều lần. Cần đo per-stage latency, queue wait, peak RAM, số retry và cache hit. Chưa có cơ sở tăng concurrency trên GPU/16GB RAM một cách tùy ý. Render segment cache và tránh double encode phải được ưu tiên trước tăng số worker.

| Thành phần chi phí thực | Video30s | Video60s | Video90s | Bằng chứng cần bổ sung |
|---|---|---|---|---|
| LLM | Chưa đo | Chưa đo | Chưa đo | Model/provider, token thực hoặc compute local. |
| Ảnh | Chưa đo | Chưa đo | Chưa đo | Số ảnh thành công/lỗi/regenerate, compute hoặc billing. |
| Generative video | Chưa tích hợp | Chưa tích hợp | Chưa tích hợp | Không gán giá dịch vụ video vào pipeline ảnh tĩnh. |
| TTS/align | Chưa đo | Chưa đo | Chưa đo | Ký tự, engine thực, thời gian máy, retry. |
| Storage/transfer | Chưa đo | Chưa đo | Chưa đo | Dung lượng tài sản, thời hạn giữ, lượt tải. |
| Render/compute | Chưa đo | Chưa đo | Chưa đo | CPU/GPU giờ, điện/khấu hao hoặc giá thuê máy. |
| Tổng cost/video | N/A | N/A | N/A | Chưa thể đưa đơn giá thực đáng tin cậy. |

Estimator hiện dùng số ảnh tối thiểu ceil(duration/7): 5/9/13 cho30/60/90giây, hoặc số scenes nếu lớn hơn. Nhánh trả phí có hệ số cứng `0.05*images + 0.03*characters/1000 + 0.01*duration/60`; đây là **công thức trong code, không phải báo giá hiện hành đã xác minh**. Chưa bao gồm đầy đủ LLM, storage, compute và retry; usage estimate cũng chưa thống nhất hoàn toàn.

Chế độ local có thể không phát sinh phí API ảnh/TTS bên ngoài, nhưng không đồng nghĩa tổng chi phí bằng0. Cần cost ledger theo job/component và reservation nguyên tử trước khi bật provider trả phí.

## 11. Thay đổi đã thực hiện và nợ kỹ thuật

Thay đổi chính: `render.ts`, `render-quality.ts` + tests, `app.ts` + cost tests, `login-responsive.css` + import, package manifests/lockfile/overrides, migration API-only writes, SQL regression, input matrix, audio smoke, audit workflow, corpus và benchmark runner. Các script CI ghi code tạm thời dùng trong audit đã được loại khỏi cây cuối; workflow audit giữ quyền contents:read.

Nợ kỹ thuật còn lại: chưa có authenticated browser E2E; chưa có semantic gate; chưa có video benchmark; chưa có scene render cache; chưa tách hoàn chỉnh regeneration của ảnh/voice/subtitle; chưa kiểm tra TTS nghe thực và tính nhất quán nhân vật; chưa có lint; cost ledger và provider budget chưa đầy đủ; tài liệu runtime cần cập nhật; triển khai migration và rollout backend/frontend cần phối hợp.

## 12. Hành động tiếp theo và điều kiện nghiệm thu

**P0:** review PR; kiểm tra dependency applicability; xác nhận API-only write path; thử migration trên staging; kiểm thử quyền bằng user thường và API trước khi áp dụng production. Không chạy các script db-bootstrap/db-baseline trên production.

**P1:** cấp một phiên QA có quyền đúng trong môi trường kiểm thử; chạy browser E2E đầy đủ và 10 video thật; triển khai idea/full-script rõ ràng; hiệu chỉnh hook/voice/visual/caption bằng video đã nghe-xem; thêm component-only regeneration và quality gate. Chưa đạt mean≥80/hook≥8 thì chưa coi sản phẩm sẵn sàng đăng ngay.

**P2:** đo 30/60/90giây trên Mac thực; stage metrics và cost ledger; segment caching; timeout/retry/resume chaos tests; sửa tài liệu và bổ sung lint. **P3:** A/B hook, brand kit, automation publishing sau khi quyền sử dụng asset và chất lượng ổn định.

Runner benchmark dùng Node và ffprobe. Từ thư mục repository:

```sh
node scripts/audit/run-benchmarks.mjs --plan
# Chỉ chạy tiếp trong môi trường QA do chủ dự án kiểm soát.
# STUDIO_BENCHMARK_TOKEN là access token ngắn hạn của user QA trong allowlist.
# Không dùng service-role key, không commit token hoặc dán token vào báo cáo/chat.
export STUDIO_API_URL='https://YOUR_QA_API'
export STUDIO_BENCHMARK_CONFIRM='CREATE_10_LOCAL_VIDEOS'
# Nạp STUDIO_BENCHMARK_TOKEN bằng secret manager của môi trường chạy.
node scripts/audit/run-benchmarks.mjs --run
```

Mặc định chỉ plan. Journal trong tmp/audit-benchmarks giữ project/job/idempotency keys để tiếp tục quan sát, không giữ token. Runner API không thay thế các thao tác browser login/edit/refresh/download cần chạy riêng. Khi thay voice phải tạo lại cues phụ thuộc; khi job đang chạy mà quan sát timeout, dùng journal cũ, không gửi lại yêu cầu tạo mới.

**Tiêu chuẩn đóng audit:** PR được review và rollout có kiểm soát; E2E có bằng chứng; 10 MP4 thực và bảng điểm đầy đủ; đạt mục tiêu chất lượng đã nêu; kiểm tra duration/cost30–60–90s; xác nhận retry không mất dữ liệu hoặc lặp chi phí; không còn P0/P1 chưa được xử lý hoặc chấp nhận rủi ro rõ ràng.
