# Đánh giá và yêu cầu cải tiến chất lượng nội dung video

Ngày đánh giá: 07/10/2026

## Kết luận

Phản hồi thực tế cho thấy video có thể render thành công nhưng chưa kể lại đầy đủ và mạch lạc kịch bản đầu vào. Đây là lỗi chất lượng nội dung P1, không phải lỗi định dạng MP4. Video chưa đạt điều kiện “đăng ngay” dù technical probe đạt H.264/AAC/1080×1920.

Không chấm điểm giả định cho các video chưa được xem và nghe hết. Điểm kỹ thuật `technical=true` chỉ chứng minh file có stream đúng định dạng, không chứng minh hook, nội dung, visual hoặc retention đạt yêu cầu.

## Nguyên nhân xác định từ pipeline

| Vấn đề | Tác động tới video |
|---|---|
| Storyboard chỉ được kiểm tra schema | JSON hợp lệ nhưng có thể bỏ chủ đề hoặc thiếu phần kết luận |
| `hook` là metadata độc lập | Hook có thể không được đọc ở scene đầu nên 3 giây đầu yếu |
| `narration` tổng và narration từng scene không được đối chiếu | Nội dung có trong kết quả AI nhưng không xuất hiện trong video thực |
| Mỗi batch ảnh thiếu vị trí trong toàn bộ câu chuyện | Cảnh đúng cục bộ nhưng không tạo được mạch hook → payoff |
| Prompt ảnh trộn tiếng Anh và narration tiếng Việt | Local CLIP/SDXL dễ bỏ qua hành động chính và tạo ảnh chung chung |
| Chưa có semantic quality gate trước media | Hệ thống vẫn tốn thời gian tạo ảnh/TTS cho storyboard không đạt |

## Yêu cầu nội dung bắt buộc

### Script và mạch kể

- Ý tưởng đầu vào phải được chuyển thành mạch: hook → bối cảnh → phát triển/xung đột → insight/payoff → kết thúc.
- Mọi ý chính của người dùng phải xuất hiện trong lời đọc của các scene; không chỉ nằm trong metadata.
- Hook dài 7–16 từ và phải là câu mở đầu được đọc trong scene 1.
- Cảnh cuối phải trả lời lời hứa của hook hoặc khép lại câu chuyện.
- Kịch bản hoàn chỉnh phải giữ nguyên câu chữ khi người dùng không bật viết lại.
- Không lặp cùng một ý bằng nhiều câu khác nhau để kéo dài video.

### Storyboard và visual

- Mỗi scene thể hiện một beat cụ thể bằng chủ thể, hành động, đồ vật và bối cảnh nhìn thấy được.
- Các scene phải có quan hệ nhân quả và tiến triển; không dùng chuỗi chân dung hoặc phong cảnh chung chung.
- Giữ nhất quán nhân vật, trang phục, địa điểm, thời điểm và đạo cụ xuyên scene.
- Thay đổi shot size/composition có chủ đích, tránh lặp một khung hình với zoom-pan.
- Prompt ảnh cho local diffusion phải dùng tiếng Anh thống nhất và không chèn narration tiếng Việt thô.

## Quality gate trước khi tạo media

Storyboard chỉ được PASS khi đồng thời đạt:

1. Số scene tối thiểu: 3 cho 30 giây, 5 cho 60 giây, 7 cho 90 giây.
2. Toàn bộ `narration` tổng phải khớp với phần lời đọc ghép theo thứ tự các scene, sau khi chuẩn hóa dấu câu.
3. Tối thiểu 35% từ khóa quan trọng từ ý tưởng nguồn được bao phủ trong lời đọc.
4. Ít nhất 65% từ khóa hook xuất hiện trong narration scene đầu.
5. Tổng lời đọc nằm trong khoảng 1,4–3,4 từ/giây mục tiêu.
6. Full-script không bật rewrite phải được bảo toàn 100% theo thứ tự.

Nếu không đạt, chỉ gọi lại bước storyboard tối đa ba lần. Không tạo ảnh, voice hoặc render cho storyboard lỗi.

## Thay đổi đã thực hiện

- Thêm `validateCreativeStoryboard` để chặn output thiếu chủ đề, thiếu narration, hook không được đọc, số scene/thời lượng lời đọc không phù hợp.
- Thêm vị trí `sceneOffset/totalScenes` cho từng batch để model hiểu scene đang nằm ở phần nào của toàn bộ câu chuyện.
- Nâng prompt storyboard theo cấu trúc hook–payoff và yêu cầu continuity xuyên scene.
- Chuẩn hóa locked-scene contract cho Ollama, OpenAI và Claude.
- Chuẩn hóa prompt tạo ảnh thành tiếng Anh, bỏ nguyên văn narration tiếng Việt khỏi prompt diffusion.
- Bổ sung regression tests cho coverage, hook, narration-to-scene consistency, locked-scene position và prompt ảnh.

## Điều kiện nghiệm thu sau rollout

- Chạy typecheck, toàn bộ unit test và build.
- Tạo lại 10 benchmark bằng code mới; video cũ không dùng để chứng minh cải tiến.
- Xem và nghe hết từng MP4, chấm đủ 10 tiêu chí; không chỉ dựa vào ffprobe.
- Trung bình Video Quality Score ≥80/100 và Hook ≥8/10.
- Không video nào có lỗi nghiêm trọng: bỏ ý chính, hook không được đọc, visual trái narration, giọng sai nội dung, subtitle lệch hoặc ending bị cắt.
- So sánh trước/sau theo coverage ý chính, tỷ lệ visual đúng beat, thời lượng thực, số scene lỗi và thời gian tạo.

## Kết quả kiểm tra trong checkout audit

| Kiểm tra | Kết quả |
|---|---|
| Typecheck | PASS — 4/4 workspace |
| Unit test TypeScript | PASS — 204/204 sau khi hợp nhất `main` mới nhất |
| Unit test Python local-tools | PASS — 19/19 |
| Production build | PASS |
| FFmpeg render smoke trong worker image | PASS — H.264/AAC, 1080×1920, ASS UTF-8, có thumbnail |
| `git diff --check` | PASS |
| Lint | Chưa có script lint trong project |

## Trạng thái hiện tại

Code đã qua các quality gate kỹ thuật trong checkout audit nhưng chưa rollout lên Mini. Chất lượng nội dung thực tế vẫn phải được xác minh bằng 10 video mới sau rollout; kết quả test và render smoke không thay thế việc xem, nghe và chấm nội dung.
