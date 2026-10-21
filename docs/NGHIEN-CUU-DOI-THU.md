# Nghiên cứu đối thủ — định hướng sản phẩm

16/10/2026 · Nghiên cứu tự động có kiểm chứng: 22 nguồn, 108 nhận định trích ra, 25 nhận định được kiểm chứng bởi
3 lượt độc lập (24 giữ lại, 1 bị bác bỏ). Mục đích: chọn tính năng nên làm tiếp cho AI Short Video Studio.

> **Giới hạn cần biết trước khi đọc.** Chỉ CapCut, Fliki, HeyGen, FPT.AI, Vbee và hai mô hình mở (VieNeu-TTS,
> PhoWhisper) có dữ kiện qua được bước kiểm chứng. InVideo AI, Pictory, VEED, Canva, Viettel AI, Lucy, Revid,
> AutoShorts, Faceless.video **chưa có dữ kiện đã xác minh** — bảng dưới để trống các ô đó thay vì đoán.
> Mọi nhận xét "giọng tự nhiên" đều do nhà cung cấp tự công bố; chưa có bài nghe thử độc lập nào.

## 1. Đối thủ đã xác minh

| | Luồng ý tưởng → video | Giọng tiếng Việt | Giá / gói miễn phí | Quyền thương mại · watermark | Nguồn |
|---|---|---|---|---|---|
| **CapCut** | Có: "Script to video" — viết lời nhắc hoặc để AI viết kịch bản, AI tự ghép ảnh/video/hoạt ảnh **từ thư viện** (không vẽ minh họa riêng) | TTS miễn phí, 200+ giọng nhiều ngôn ngữ, có tiếng Việt; số giọng Việt và chất lượng không công bố | Standard ~9,99 USD/tháng (1080p); Pro 19,99 USD/tháng hoặc 179,99 USD/năm, 1.200 điểm AI/tháng, 4K (giá Mỹ, đổi theo vùng; chưa có giá VND) | **Phức tạp:** Điều khoản (4/2026) cấp cho CapCut giấy phép vĩnh viễn, toàn cầu, có thể cấp phép lại với nội dung bạn tạo; tư liệu trong app mặc định **chỉ phi thương mại** và chỉ được sửa trong CapCut, trừ tài sản gắn nhãn thương mại | [1] [2] [3] [4] [5] |
| **Fliki** | Có: từ ý tưởng, kịch bản, bài blog, PPT | 80+ ngôn ngữ; không có dữ liệu chất lượng tiếng Việt | Miễn phí: ~5 phút/tháng, 720p | Miễn phí: **có watermark, không có quyền thương mại**; từ gói Standard mới có | [6] |
| **HeyGen** | (avatar, không phải trọng tâm video kể chuyện) | — | Gói miễn phí giới hạn, có watermark | ~40% than phiền về giá: "unlimited" vẫn tính credit, bị trừ credit khi lỗi, khó hoàn tiền (nguồn tổng hợp thứ cấp) | [7] |
| **FPT.AI TTS** | **Không** — chỉ bán giọng đọc | Giọng v5 "thế hệ mới" | Miễn phí 100.000 ký tự/tháng (chậm, xếp hàng, giới hạn lượt/ngày); trả phí 500.000đ → 1,5 triệu ký tự … 5.000.000đ → 27 triệu ký tự (~185–333đ/1.000 ký tự) | — | [8] |
| **Vbee** | **Không** — chỉ ra MP3/WAV; có lồng tiếng từ file SRT | Tự nhận "tự nhiên, giàu cảm xúc"; nhân bản giọng từ vài phút ghi âm; chỉnh từng câu | Gói tùy chỉnh (4/2025): 500đ/1.000 ký tự, tối thiểu 5 triệu ký tự (~2,5 triệu đồng); bảng giá hiện tại chỉ "liên hệ" | — | [9] [10] |
| InVideo AI, Pictory, VEED, Canva, Viettel AI, Lucy, Revid, AutoShorts, Faceless.video | *chưa xác minh* | | | | |

**Bác bỏ (0/3 phiếu):** "Điều khoản CapCut cho phép dùng tên, hình ảnh, giọng của người dùng trong nội dung tài trợ" — không đúng với văn bản gốc.

## 2. Mô hình mở có thể dùng cho bản local

| Mô hình | Điểm chính | Ghi chú |
|---|---|---|
| **VieNeu-TTS** (Apache-2.0, v3.8.3 · 9/2026) [11] | TTS tiếng Việt offline, **nhân bản giọng từ 3–8 giây mẫu**, trộn Anh–Việt trong câu, bản ONNX chạy CPU/macOS không cần PyTorch, RTF ~0,5 | Studio **đã dùng** VieNeu (v3-turbo) nhưng **chưa có nhân bản giọng** trên giao diện. Bản v4 là mã đóng. Chưa có MOS độc lập |
| **PhoWhisper** (VinAI, BSD-3) [12] | Whisper fine-tune trên 844 giờ tiếng Việt nhiều vùng miền; large: WER 8,14 (Common Voice), 4,67 (VIVOS); bản medium gần bằng large | Studio đang dùng **whisper ggml-base** (nhỏ nhất). Cần đổi sang CTranslate2/GGML; chưa chắc giữ được timestamp cấp từ cho karaoke |

## 3. Khoảng trống thị trường (suy luận, chưa kiểm chứng trên toàn thị trường)

Trong các đối thủ đã xác minh, **chưa ai có đủ cùng lúc**:

1. Một công cụ tiếng Việt đi trọn ý tưởng → kịch bản → cảnh → **ảnh minh họa riêng** → giọng Việt → phụ đề karaoke → video dọc.
2. **Không watermark, không giới hạn phút/credit/ký tự** — đối thủ quốc tế khóa quyền thương mại và độ phân giải sau paywall; nhà cung cấp Việt bán theo ký tự.
3. **Nội dung thuộc hẳn người dùng** — không cấp giấy phép cho nền tảng, không vướng "tư liệu chỉ phi thương mại" như CapCut.
4. **Chi phí cố định 0đ** sau khi cài.

Đổi lại, bản local có điểm yếu thật: cần máy đủ mạnh, cài đặt phức tạp hơn, và tạo ảnh SDXL trên Mac chậm hơn dịch vụ đám mây.

## 4. Đối chiếu với Studio hiện tại

| Đề xuất từ nghiên cứu | Studio hiện có | Còn thiếu |
|---|---|---|
| Chỉnh và tạo lại từng cảnh | ✅ Sửa lời, mô tả ảnh, "Tạo lại" ảnh/giọng/phụ đề riêng từng cảnh | Sửa thời lượng cảnh bằng tay |
| Mẫu tái sử dụng cho kênh | ✅ Mẫu kênh, thẻ truyện, logo kéo thả | Lưu **bộ nhận diện kênh** (logo + khung + giọng + phong cách) để dùng lại một chạm |
| Chuẩn TikTok/Reels/Shorts | ✅ Vùng an toàn, caption + hashtag gợi ý | — |
| Giọng tốt hơn | ✅ VieNeu | **Nhân bản giọng**, chỉnh ngữ điệu/tốc độ từng câu |
| Phụ đề chính xác | ✅ Whisper base + căn theo kịch bản | Model tốt hơn (PhoWhisper/Whisper lớn), **trình sửa phụ đề** |
| Tạo hàng loạt | ❌ | Nhiều video từ một danh sách ý tưởng |
| Minh bạch quyền sử dụng | ❌ | Trang giấy phép mô hình/font/nhạc |
| Cài đặt dễ, ước tính thời gian | 🟡 Có hàng đợi, trạng thái máy | Trình cài một bước; ước tính "xong lúc …" |

## 5. Tính năng nên ưu tiên

Thứ tự theo **khác biệt với đối thủ × công sức**; nên chốt lại sau vòng nghiên cứu người dùng (docs/NGHIEN-CUU-NGUOI-DUNG.md).

| # | Tính năng | Vì sao | Công sức |
|---|---|---|---|
| 1 | **Nhân bản giọng của chính người dùng** (VieNeu, 3–8 giây mẫu, có xin đồng ý khi ghi âm) | Vbee bán theo ký tự, CapCut không có cho tiếng Việt; "giọng của kênh mình" là lý do giữ chân mạnh | Vừa — engine đã có |
| 2 | **Phụ đề chính xác hơn + trình sửa phụ đề** (thử PhoWhisper-medium hoặc Whisper large-v3-turbo; căn theo kịch bản gốc) | Phụ đề sai dấu là lỗi người xem thấy ngay; đang dùng model nhỏ nhất | Vừa |
| 3 | **Bộ nhận diện kênh** lưu sẵn (logo, vị trí, khung, giọng, phong cách ảnh, outro) | Biến tính năng đã có thành "một chạm"; hợp với kênh faceless đăng đều | Nhỏ |
| 4 | **Tạo hàng loạt** từ danh sách ý tưởng, chạy qua đêm | Lợi thế "không giới hạn" chỉ có ý nghĩa khi làm được nhiều video | Vừa |
| 5 | **Trang "Quyền sử dụng"**: giấy phép SDXL/checkpoint, VieNeu, Whisper, font, nhạc; khẳng định video thuộc người dùng | Đối trọng trực tiếp với điều khoản CapCut; rẻ để làm — **cần kiểm tra giấy phép checkpoint ảnh đang dùng trước** | Nhỏ |
| 6 | **Thư viện nhạc nền có giấy phép thương mại rõ** | Nhạc là chỗ creator hay bị gỡ video | Nhỏ–vừa |
| 7 | **Ước tính thời gian + chế độ nhẹ cho máy yếu**; trình cài một bước | Giảm điểm yếu lớn nhất của bản local (chờ lâu, khó cài) | Vừa |
| 8 | **Chỉnh ngữ điệu/tốc độ từng câu** | Vbee dùng làm điểm bán hàng | Vừa |

## 6. Câu hỏi còn mở

1. Giọng VieNeu so với CapCut, Vbee, FPT.AI v5, Viettel thực tế ra sao (nghe mù / MOS), và tốc độ trên M1–M4?
2. PhoWhisper sau khi chuyển định dạng có giữ timestamp cấp từ đủ cho karaoke không, hay cần forced alignment (WhisperX, MFA)?
3. Giá, gói miễn phí, watermark, hỗ trợ tiếng Việt năm 2026 của InVideo AI, Pictory, VEED, Canva, Revid, AutoShorts, Faceless.video?
4. Giấy phép thương mại của checkpoint/LoRA ảnh đang dùng trên ComfyUI có cho phép kiếm tiền từ video không?

## Nguồn

1. CapCut — Text to video (vi-vn): https://www.capcut.com/vi-vn/resource/text-to-video-maker
2. CapCut — Text to Speech (vi-vn): https://www.capcut.com/vi-vn/tools/text-to-speech
3. Fluxnote — CapCut questions answered (6/2026): https://fluxnote.io/guides/capcut-questions-answered · CapCut — Pricing change: https://www.capcut.com/help/pricing-change
4. CapCut — Terms of Service: https://www.capcut.com/clause/terms-of-service · Material License Agreement: https://www.capcut.com/clause/material-license-agreement
5. marketing4ecommerce — CapCut new terms: https://marketing4ecommerce.net/en/capcut-new-terms/ · autoae — Is CapCut free for commercial use: https://autoae.online/blog/is-capcut-free-for-commercial-use
6. Fliki — Pricing: https://fliki.ai/pricing
7. Kimola — HeyGen consumer insights: https://kimola.com/reports/heygen-ai-video-generation-app-consumer-insights
8. FPT.AI — TTS pricing: https://docs.fpt.ai/docs/en/speech/documentation/tts-pricing
9. Vbee: https://vbee.vn/en
10. Vbee — Bản cập nhật tháng 04/2025: https://help.vbee.vn/docs/thong-bao/ban-cap-nhat-thang-04-2025
11. VieNeu-TTS (PyPI): https://pypi.org/project/vieneu/
12. PhoWhisper (arXiv 2406.02555): https://arxiv.org/pdf/2406.02555
