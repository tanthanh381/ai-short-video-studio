# Kế hoạch nghiên cứu người dùng — AI Short Video Studio

Phiên bản 1 · 16/10/2026 · Dùng cho vòng thử nghiệm đầu tiên với người làm nội dung thật.

## 1. Mục tiêu

Các đợt rà soát trước (design system, design critique, UX copy, accessibility) đều do chuyên gia đánh giá. Vòng này kiểm
chứng với **người dùng thật**: họ có tự làm ra được một video đăng được không, kẹt ở đâu, và có muốn dùng tiếp không.

### Câu hỏi nghiên cứu

| # | Câu hỏi | Vì sao quan trọng |
|---|---|---|
| Q1 | Người mới có tự đi từ **ý tưởng → video MP4** mà không cần hướng dẫn không? | Luồng chính; chưa ai ngoài nhóm thử từ đầu đến cuối |
| Q2 | Thời gian chờ (vài phút cho mỗi video, máy chạy local) có làm họ bỏ dở không? Họ hiểu tiến độ đang ở đâu không? | Rủi ro lớn nhất của mô hình "chạy trên máy, không tốn phí" |
| Q3 | Họ có tìm được và dùng được việc **sửa từng cảnh** (lời đọc, mô tả ảnh, Tạo lại) không? | Khác biệt chính so với công cụ "một nút ra video" |
| Q4 | Chất lượng đầu ra (giọng đọc tiếng Việt, ảnh, phụ đề) có **đủ để đăng** không? Thiếu gì? | Quyết định họ có quay lại |
| Q5 | Họ hiểu các khái niệm: Mẫu kênh, Tùy chọn video, máy chính/máy phụ, chế độ mẫu? | Kiểm tra lại kết quả đợt UX copy |
| Q6 | Lồng tiếng & phụ đề và TTS có được dùng độc lập không, hay chỉ là tính năng phụ? | Ưu tiên phát triển tiếp |

### Không nằm trong phạm vi
Trang Hệ thống/Cài đặt máy (dành cho chủ máy), giá cả, so sánh tính năng chi tiết với đối thủ.

## 2. Phương pháp

| Phương pháp | Số người | Thời lượng | Dùng để trả lời |
|---|---|---|---|
| **Thử nghiệm khả dụng có điều phối** (nghĩ thành lời) + phỏng vấn ngắn | 6 người | 60 phút/người | Q1–Q5 |
| Khảo sát ngắn sau 1 tuần dùng thử | Cả 6 người + ai được mời thêm | 5 phút | Q4, Q6, ý định dùng tiếp |

Lý do chọn: 5–6 người đủ phát hiện phần lớn lỗi khả dụng của một luồng; mỗi phiên vừa quan sát hành vi vừa nghe lý do.

**Hình thức:** gặp trực tiếp hoặc Google Meet có chia sẻ màn hình. Người tham gia dùng **máy tính của họ** (để thấy
trình duyệt, kết nối mạng thật); 1–2 người thử trên **điện thoại** cho luồng sửa cảnh.

## 3. Người tham gia

### Tiêu chí
- Đã đăng **ít nhất 3 video ngắn** (TikTok, Reels, Shorts) trong 3 tháng qua, **hoặc** đang muốn mở kênh và đã thử một công cụ (CapCut, InVideo, Pictory, Canva…).
- Nội dung tiếng Việt.
- Pha trộn: 3 người **chưa từng dùng AI tạo video**, 3 người **đã dùng** công cụ AI khác.
- Ít nhất 2 nhóm nội dung khác nhau trong số: kể chuyện / cổ tích, kiến thức / mẹo, chữa lành / tâm sự, review.
- Không phải người trong nhóm phát triển hoặc đã xem bản demo.

### Câu hỏi sàng lọc (gửi qua Google Form)
1. Trong 3 tháng qua bạn đăng bao nhiêu video ngắn? (0 · 1–2 · 3–10 · trên 10)
2. Kênh của bạn thuộc chủ đề nào?
3. Bạn đang làm video bằng công cụ gì? Đã từng dùng công cụ AI tạo video chưa? Công cụ nào?
4. Mỗi video thường mất bao lâu để làm?
5. Bạn có thể tham gia 60 phút qua Google Meet (hoặc gặp trực tiếp) vào tuần … không?

**Quà cảm ơn:** gợi ý 200.000–300.000 đ hoặc 1 tháng dùng miễn phí khi ra bản chính thức.

## 4. Chuẩn bị (trước phiên)

- [ ] Tạo **6 tài khoản thử nghiệm** riêng (không dùng tài khoản của chủ studio). Lưu thông tin trong trình quản lý mật khẩu, không ghi vào tài liệu này.
- [ ] Bảo đảm **Mac Mini và MacBook Air đang bật** suốt phiên; xem trang Hệ thống 15 phút trước giờ hẹn, hàng đợi trống.
- [ ] Mỗi tài khoản có sẵn **1 dự án đã làm xong** (để Nhiệm vụ 3 không phải chờ tạo video).
- [ ] Mẫu biên bản đồng ý ghi hình (mục 8) và mẫu ghi chép (mục 6).
- [ ] Chạy thử toàn bộ kịch bản với 1 người trong nhóm (pilot) để căn thời gian.
- [ ] Một video ngắn có sẵn (MP4, < 50 MB) gửi trước cho người tham gia, dùng cho Nhiệm vụ 4.

## 5. Kịch bản phiên (60 phút)

### Mở đầu — 5 phút
> "Cảm ơn bạn đã dành thời gian. Hôm nay mình thử một công cụ làm video ngắn đang được phát triển. Mình đang kiểm tra
> **công cụ**, không kiểm tra bạn — chỗ nào khó là lỗi của công cụ. Bạn cứ nói to suy nghĩ khi làm: đang tìm gì, nghĩ
> nút này làm gì, chỗ nào thấy lạ. Mình có thể không trả lời câu hỏi ngay để xem bạn tự làm thế nào. Mình ghi màn hình
> và giọng nói để xem lại, chỉ nhóm phát triển xem. Bạn đồng ý chứ?"

### Bối cảnh — 10 phút (phỏng vấn)
1. Kể cho mình về **video gần nhất** bạn làm: ý tưởng từ đâu, các bước, mất bao lâu?
2. Bước nào **tốn thời gian** hoặc **chán** nhất?
3. Bạn đã thử công cụ AI nào chưa? Điều gì khiến bạn dùng tiếp hoặc bỏ?
4. Một video thế nào thì bạn **chịu đăng**? Điều gì khiến bạn không đăng?

### Nhiệm vụ — 35 phút
Đọc nhiệm vụ cho người tham gia, không chỉ nút. Sau mỗi nhiệm vụ hỏi: *"Từ 1 (rất khó) đến 7 (rất dễ), nhiệm vụ này
thế nào?"* (SEQ).

| # | Nhiệm vụ (đọc cho người tham gia) | Thành công khi | Quan sát gì | Câu hỏi |
|---|---|---|---|---|
| 1 | "Bạn muốn làm một video khoảng 1 phút về **một chủ đề của kênh bạn**. Hãy bắt đầu." | Bấm Tạo video với ý tưởng đúng thời lượng | Chọn "Một ý tưởng" hay "Kịch bản có sẵn"? Có để ý Mẫu kênh, Tùy chọn video? Đọc dòng "Dàn ý AI sẽ viết"? | Q1, Q5 |
| 2 | (Trong lúc chờ) "Video đang được làm. Bạn sẽ làm gì lúc này? Bao giờ thì xong?" | Nói được video đang ở bước nào, ước lượng thời gian | Có rời trang không? Có hiểu thanh tiến độ, nút Dừng? Cảm xúc khi chờ | Q2 |
| 3 | (Mở dự án đã làm sẵn) "Câu thứ 2 đọc chưa hay và ảnh cảnh 3 chưa đúng ý. Hãy sửa cho vừa ý rồi tải video về." | Sửa lời đọc cảnh 2, tạo lại ảnh cảnh 3, tải MP4 | Tìm thấy menu ⋯ của cảnh? Hiểu "Tạo lại" chỉ làm lại phần đó? Tìm nút tải? | Q3 |
| 4 | "Bạn có sẵn một video quay cảnh, muốn thêm giọng đọc và phụ đề tiếng Việt." | Tải video lên, nhập lời thoại, tạo bản lồng tiếng | Tìm được trang Lồng tiếng & phụ đề? Hiểu "Bước 1 · Tải video lên"? | Q6 |
| 5 | (Tuỳ thời gian, trên điện thoại) "Mở lại video vừa làm trên điện thoại và đổi tiêu đề." | Mở dự án, sửa tên | Thanh nút dưới đáy, menu ⋯ trên điện thoại | Q3 |

**Quy tắc điều phối:** không chỉ chỗ bấm; nếu kẹt quá 2 phút, hỏi *"Bạn đang tìm gì?"*, quá 4 phút thì gợi ý và ghi
là "thành công có trợ giúp".

### Phản hồi — 7 phút
1. Xem video vừa tạo: **bạn có đăng video này không?** Nếu không, cần sửa gì?
2. Giọng đọc / ảnh / phụ đề: cái nào tốt nhất, cái nào kém nhất?
3. So với cách bạn đang làm, công cụ này nhanh hơn hay chậm hơn? Đáng không?
4. Nếu có một thứ được đổi ngay, bạn đổi gì?

### Kết thúc — 3 phút
- "Từ 0 đến 10, bạn giới thiệu công cụ này cho một người làm nội dung khác ở mức nào?" (NPS)
- Có muốn dùng thử tiếp 1 tuần không? (dùng cho khảo sát sau)
- Cảm ơn, gửi quà.

## 6. Ghi chép và số đo

### Mẫu ghi chép (một bảng mỗi người)

| Nhiệm vụ | Kết quả (✅ tự làm / 🟡 có trợ giúp / ❌ không xong) | Thời gian | SEQ (1–7) | Chỗ kẹt / lời nói nguyên văn |
|---|---|---|---|---|
| 1 Ý tưởng → Tạo video | | | | |
| 2 Hiểu lúc chờ | | | | |
| 3 Sửa cảnh + tải MP4 | | | | |
| 4 Lồng tiếng | | | | |
| 5 Điện thoại | | | | |

Ghi lời nói **nguyên văn** trong ngoặc kép; ghi hành động thấy được tách khỏi suy đoán của người ghi.

### Số đo tổng hợp
- Tỷ lệ hoàn thành từng nhiệm vụ (mục tiêu: ≥ 5/6 tự làm cho Nhiệm vụ 1 và 3).
- SEQ trung bình từng nhiệm vụ (mục tiêu ≥ 5,5).
- Số người **chịu đăng** video tạo ra (Câu phản hồi 1).
- NPS (chỉ để tham khảo với 6 người).

## 7. Tổng hợp kết quả (sau 6 phiên)

1. **Gom ghi chú** mỗi quan sát thành một thẻ (FigJam, Miro hoặc giấy dán).
2. **Nhóm theo chủ đề** (affinity mapping): ví dụ "không hiểu Mẫu kênh", "lo lắng khi chờ", "giọng đọc đều đều".
3. **Chấm mức độ** mỗi vấn đề:

   | Mức | Nghĩa |
   |---|---|
   | 🔴 Chặn | Người dùng không làm tiếp được |
   | 🟠 Nặng | Làm được nhưng mất nhiều thời gian hoặc bực bội; ≥ 3/6 người gặp |
   | 🟡 Vừa | Chậm lại nhưng tự vượt qua |
   | 🟢 Nhẹ | Góp ý, sở thích |

4. **Ưu tiên** bằng ma trận tác động × công sức; sửa nhóm "tác động cao, công sức thấp" trước.
5. **Báo cáo** 1 trang: 3–5 phát hiện chính, mỗi phát hiện kèm bằng chứng (số người, câu nói nguyên văn, đoạn ghi hình)
   và đề xuất. Có thể dùng `/design:research-synthesis` với ghi chú các phiên để tổng hợp.

## 8. Đạo đức và dữ liệu

- Xin đồng ý **trước khi ghi hình**; người tham gia có thể dừng bất cứ lúc nào mà vẫn nhận quà.
- Dùng tài khoản thử nghiệm; **không** yêu cầu người tham gia đăng nhập tài khoản riêng hay nhập khóa API của họ.
- Bản ghi lưu trong thư mục riêng, chỉ nhóm phát triển xem, xóa sau 3 tháng; trong báo cáo gọi là P1–P6, không ghi tên.
- Ý tưởng/kịch bản người tham gia nhập là của họ: hỏi trước nếu muốn dùng làm ví dụ.

## 9. Lịch đề xuất

| Tuần | Việc |
|---|---|
| Tuần 1 | Gửi form sàng lọc, chọn 6 người + 1 dự phòng; chuẩn bị tài khoản, dự án mẫu; chạy pilot |
| Tuần 2 | 6 phiên (2 phiên/ngày, cách nhau ≥ 30 phút để máy nghỉ và ghi chép) |
| Tuần 2–3 | Tổng hợp, báo cáo; gửi khảo sát sau 1 tuần dùng thử |
| Tuần 3 | Chốt danh sách sửa, đưa vào kế hoạch phát triển |

## Phụ lục — Khảo sát sau 1 tuần (5 phút)

1. Tuần qua bạn tạo bao nhiêu video bằng công cụ? Đăng bao nhiêu?
2. Lý do chính không đăng (nếu có)? (giọng đọc · ảnh · phụ đề · nội dung kịch bản · chờ lâu · khác)
3. Bạn có dùng Lồng tiếng & phụ đề / Đọc văn bản (TTS) không? Để làm gì?
4. Điều bạn thích nhất? Điều bạn muốn thay đổi nhất?
5. Bạn có tiếp tục dùng không? (chắc chắn · có thể · không) — vì sao?
