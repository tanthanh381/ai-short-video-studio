# Tiếp tục audit: sửa riêng ảnh, giọng đọc và phụ đề

Ngày: 05/10/2026. Báo cáo bổ sung cho REPORT.vi.md, không thay thế các giới hạn đã nêu trong báo cáo trước.

## Kết quả đã xác minh

Đã tiếp tục sửa mã nguồn và kiểm thử trên GitHub Actions, không sử dụng TinyFish. Thay đổi nằm trong Draft PR #1, nhánh `audit/2026-10-05-product-hardening`. Chưa merge main, chưa deploy frontend/API/worker và không áp dụng migration production trong đợt tiếp tục này.

Commit runtime đã kiểm thử: `f87515f343147a074acd215ee5a87282f0effc70`.
Run kiểm thử: https://github.com/tanthanh381/ai-short-video-studio/actions/runs/37292377390
Artifact: `component-repair-37292377390`, ID `11337391473`.

| Chỉ số | Lần audit trước | Sau bản sửa component |
|---|---:|---:|
| TypeScript tests | 146 đạt | 185/185 đạt |
| Python tests | 9 đạt | 9/9 đạt |
| Typecheck | Đạt | Đạt |
| Build | Đạt | Đạt |
| Dependency advisories | 0 | 0 tại thời điểm kiểm tra |
| Kiểm tra giao diện sửa riêng thành phần | Chưa có | 6/6 đạt, auth/API giả lập |
| Video AI benchmark thực | 0/10 | 0/10 |

185 test TypeScript gồm shared 32, web 17, worker 109 và API 27. Thêm 39 test so với đợt trước. Đây là số test đã chạy, không phải số tính năng E2E production được chứng nhận. Repo vẫn chưa có lint script; không báo lint PASS.

## Thay đổi P1

Đã thêm ba lựa chọn ngay trong scene card:

| Thao tác | Thành phần tạo lại | Thành phần giữ lại |
|---|---|---|
| Tạo lại ảnh | Ảnh của cảnh được chọn | Audio và phụ đề hiện có |
| Tạo lại giọng và phụ đề | Audio của cảnh và phụ đề phụ thuộc | Ảnh |
| Đồng bộ lại phụ đề | Cues từ audio hiện có | Ảnh và audio |

Thao tác tạo lại cả cảnh vẫn được giữ để tương thích hành vi cũ. API chấp nhận component all/image/audio/subtitles; trường bị bỏ trống mặc định all. Worker kiểm tra thành phần phụ thuộc trước khi xử lý. Nếu thiếu thành phần cần giữ, tác vụ báo rõ lỗi thay vì tự ý tạo lại các phần ngoài phạm vi.

Retry sử dụng checkpoint để giữ ảnh/audio đã tạo thành công. Đường đồng bộ phụ đề có checkpoint hoàn tất riêng. Đây không phải bảo đảm exactly-once tuyệt đối: nếu tiến trình dừng sau khi lưu scene nhưng trước khi lưu checkpoint, bước phụ đề có thể lặp một lần.

## Củng cố kiểm soát API

Payload regenerate_scene trước đây là đối tượng mở. Bản sửa chỉ giữ sceneId và component tại biên API; loại bỏ checkpoint/đường dẫn cleanup do client gửi lên. Checkpoint nội bộ do worker tạo. Test API xác nhận loại bỏ dữ liệu client không được phép, từ chối component sai bằng HTTP 400 và yêu cầu đăng nhập. Không thực hiện khai thác trên dữ liệu thật.

## Kiểm thử giao diện

Đã chạy Chromium trên frontend build của PR với session giả lập và API được intercept. Ba nút sửa riêng thành phần gửi đúng component; cả ba trường hợp không tràn ngang ở viewport 390 x 844; không có page exception. Ảnh repair-image.png, repair-audio.png và repair-subtitles.png lưu trong artifact.

Không được diễn giải kết quả này là đăng nhập thành công bằng tài khoản test thật, hoặc là đã chạy các model AI thật. Nó kiểm tra wiring từ nút giao diện tới request API; unit/API tests kiểm tra phần validation và lựa chọn tác vụ. Pipeline provider/worker production còn cần E2E thực.

## Điều kiện truy cập kiểm thử thật

Preflight riêng đã chạy tại:
https://github.com/tanthanh381/ai-short-video-studio/actions/runs/37291777511

Kết quả artifact preflight.json:

```json
{
  "emailSecretConfigured": false,
  "passwordSecretConfigured": false,
  "authenticated": false,
  "websiteHttp": 200
}
```

GitHub Actions truy cập được website; TinyFish không phải điều kiện bắt buộc. Môi trường chạy mã trực tiếp trong phiên hội thoại không kết nối được website. Hai biến bí mật chuẩn STUDIO_QA_EMAIL và STUDIO_QA_PASSWORD chưa được cung cấp cho Actions runner. Chưa thử đăng nhập nên không có kết luận mật khẩu đúng/sai hoặc tài khoản có/không có quyền. Không chép thông tin đăng nhập từ hội thoại vào source, issue, PR hoặc artifact.

Tài khoản test đã được người dùng cung cấp; điểm còn thiếu là kênh nạp bí mật vào môi trường chạy kiểm thử, không phải sự đồng ý kiểm thử hoặc yêu cầu kết nối TinyFish. Connector GitHub hiện dùng không có action tạo/cập nhật Actions Secrets. Không dùng khóa service-role để thay thế phiên người dùng.

## Phần còn thiếu so với yêu cầu ban đầu

Chưa tạo 10 video AI thực. Chưa đánh giá chất lượng tiếng nói, hình ảnh, hook, cảm xúc, retention, shareability hoặc điểm trung bình 80/100. Các điểm giữ trạng thái chưa đánh giá, không gán số giả định.

Bản sửa component giảm việc gọi lại AI ngoài phần cần sửa; không phải cache các đoạn FFmpeg. Render MP4 cuối vẫn có thể encode lại các segment. Chưa hoàn thiện semantic quality gate tự chấm và tự sửa. Chưa có số liệu cost/video thực 30/60/90 giây. Chưa triển khai chế độ ý tưởng tự mở rộng thành kịch bản hoàn chỉnh trong luồng một nút.

Overall Product Score: CHƯA CHẤM. Production Readiness: NOT READY theo tiêu chí nhập ý tưởng rồi đăng ngay. Bản sửa có thể review tại PR #1; không coi unit/browser-mock test là nghiệm thu sản phẩm production.

## Vận hành mã kiểm thử

Script áp dụng bản vá một lần đã được loại khỏi nhánh sau khi tạo commit runtime. Workflow component-fix.yml được chuyển thành regression chỉ đọc, không còn tự sửa/commit source. Bộ test và script browser được giữ lại để kiểm tra các thay đổi sau này.
