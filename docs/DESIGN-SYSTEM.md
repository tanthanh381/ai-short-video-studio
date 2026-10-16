# Hệ thống thiết kế (design system)

Mọi màu, cỡ chữ, khoảng cách, bo góc và đổ bóng của web nằm trong các token CSS ở đầu
[`apps/web/src/styles.css`](../apps/web/src/styles.css). Các control dùng chung nằm trong
[`apps/web/src/components/ui.tsx`](../apps/web/src/components/ui.tsx). Muốn đổi giao diện toàn site: đổi token,
không sửa từng màn hình.

## 1. Token

Token đặt tên theo **vai trò**, không theo màu: `--bad` thay vì `--red`. Nhờ vậy chế độ tối chỉ cần định nghĩa lại
giá trị token.

| Nhóm | Token | Dùng cho |
|---|---|---|
| Chữ | `--text`, `--text-strong`, `--text-2`, `--text-soft`, `--text-muted`, `--text-faint` | Từ đậm nhất (tiêu đề) tới nhạt nhất (chú thích phụ). `--text-faint` chỉ dùng cho chữ không bắt buộc đọc. |
| Chữ trên nền tối / nền nhấn | `--text-on-dark`, `--text-on-dark-muted`, `--text-on-accent` | Thanh bên, nút primary. |
| Liên kết | `--link` | Chữ dạng link, chữ màu nhấn trên nền sáng. Đừng dùng `--accent` làm màu chữ. |
| Nền | `--canvas` (nền trang), `--surface` (thẻ), `--surface-2`…`--surface-5` (lớp lồng nhau, hover) | |
| Thanh bên | `--nav`, `--nav-2`…`--nav-4` | |
| Viền | `--line`, `--line-soft`, `--line-strong`, `--line-hover`, `--line-dark` | |
| Nhấn | `--accent`, `--accent-strong`, `--accent-soft(-2)`, `--accent-line(-strong)` | Hành động chính, trạng thái đang chọn. |
| Sắc thái | `--ok*`, `--warn*`, `--bad*`, `--idle` | Mỗi sắc thái có nền nhạt (`-soft`), viền (`-line`) và chữ đủ tương phản (`-text`). |
| Biểu đồ | `--chart-1`…`--chart-4` | Màu từng máy trên trang Hệ thống. |
| Focus | `--focus-ring` (box-shadow), `--focus-outline` | Một vòng focus duy nhất cho toàn site. |
| Cỡ chữ | `--text-xs` 11 · `--text-sm` 12 · `--text-md` 13 · `--text-base` 14 · `--text-lg` 16 · `--text-xl` 20 · `--text-2xl` 30 (px) | Không viết cỡ chữ cứng. |
| Khoảng cách | `--space-1`…`--space-6` = 4 · 8 · 12 · 16 · 24 · 32 px | Padding, margin, gap dùng bội số 4. |
| Bo góc | `--radius-sm` 4 · `--radius-md` 8 · `--radius-lg` 12 · `--radius-xl` 20 · `--radius-full` | |
| Đổ bóng | `--shadow-1` (thẻ), `--shadow-2` (popover), `--shadow-3` (hộp thoại) | |
| Chuyển động | `--ease`, `--duration-fast`, `--duration` | |
| Breakpoint | 560 · 760 · 1100 px | Media query không hỗ trợ biến CSS nên giá trị viết trực tiếp, nhưng chỉ được dùng ba mốc này. |

Các tên cũ (`--ink`, `--paper`, `--blue`, `--mint`, `--green`, `--primary`, `--danger`, `--muted`…) vẫn còn, dưới
dạng **alias** trỏ vào token mới, để code cũ không vỡ. Code mới không dùng chúng.

## 2. Chế độ tối

Site đi theo cài đặt của hệ điều hành (`prefers-color-scheme: dark`). Khối dark chỉ định nghĩa lại token, không
có selector riêng cho từng component. Gắn `data-theme="light"` lên `<html>` để ép giao diện sáng.

Khi thêm style mới:
- Chỉ dùng token. Màu viết cứng sẽ giữ nguyên trong chế độ tối và thường không đọc được.
- Nền tối dùng `--nav`, không dùng `--text`. Chữ trên nút primary dùng `--text-on-accent`.
- Kiểm tra tương phản ở cả hai chế độ. Chữ thường cần ≥ 4.5:1, chữ lớn ≥ 3:1.

## 3. Sắc thái (tone)

Năm sắc thái dùng chung cho `Notice`, `Badge` và các chấm trạng thái:

| Tone | Ý nghĩa | Ví dụ |
|---|---|---|
| `info` | Thông tin, đang xử lý | "Đang tạo ảnh cảnh 3" |
| `ok` / `success` | Thành công, khỏe | "Đã xuất video" |
| `warn` | Cần biết nhưng chưa hỏng | "Ổ đĩa còn 15 GB" |
| `bad` | Lỗi, người dùng phải xử lý | "Không kết nối được máy chủ" |
| `idle` | Tắt, chưa có số liệu | "Đang ngủ" |

Lỗi luôn dùng `bad`, không dùng `warn`. Chỉ `bad` được đọc ngay bởi trình đọc màn hình (`role="alert"`).

## 4. Component

### Button

```tsx
<Button onClick={save}>Lưu</Button>
<Button variant="secondary">Hủy</Button>
<Button variant="danger" busy={cancelling}>Dừng tạo video</Button>
```

| Prop | Kiểu | Mặc định | Mô tả |
|---|---|---|---|
| `variant` | `"primary" \| "secondary" \| "ghost" \| "danger"` | `primary` | `primary`: hành động chính, mỗi màn hình một nút. `secondary`: hành động khác. `ghost`: hành động phụ nằm trong nội dung. `danger`: xóa hoặc dừng. |
| `busy` | `boolean` | – | Hiện spinner, khóa nút, đặt `aria-busy`. |
| `type` | | `button` | Đặt `submit` khi nút gửi form. |

Trạng thái: hover sẫm màu hơn; focus có `--focus-ring`; disabled mờ đi và không bấm được; busy có spinner.

### Notice

```tsx
<Notice tone="bad">{error}</Notice>
<Notice tone="warn">Máy Air đang hạn chế</Notice>
```

| Prop | Kiểu | Mặc định |
|---|---|---|
| `tone` | `"info" \| "success" \| "warn" \| "bad"` | `info` |

Mỗi tone có icon riêng nên không phụ thuộc vào màu. `bad` dùng `role="alert"` + `aria-live="assertive"`; các tone
khác dùng `role="status"` + `polite`.

### Badge

```tsx
<Badge tone="ok">Sẵn sàng</Badge>
```

Chip trạng thái nhỏ trong một trong năm tone (class `.badge.tone-*`).

### Field

```tsx
<Field label="Giọng đọc" hint="Giọng nào cũng đọc được tiếng Việt">
  <select>…</select>
</Field>
```

Nhãn bọc control, nên bấm vào nhãn sẽ focus control. `hint` hiện sau nút (i) để form gọn.

## 5. Quy tắc tương tác

- **Nút chính luôn bấm được.** Thiếu dữ liệu (ô trống, kịch bản quá ngắn) thì bấm sẽ hiện `Notice tone="bad"` ngay
  cạnh ô, nói rõ cần nhập gì; lỗi tự mất khi người dùng sửa. Chỉ khóa nút khi lý do đang hiện trên màn hình (ví dụ
  banner chế độ mẫu) hoặc khi đang chạy (`busy`).
- **Máy chưa kết nối** luôn kèm đường đi: dòng chú thích và link sang trang Hệ thống (`EngineSelect` làm sẵn việc này).
- **Mô tả trang** viết thành một dòng `<p>` dưới tiêu đề, không giấu trong (i). Chỉ dùng (i) / `hint` của `Field` cho
  giải thích không bắt buộc đọc và gắn với đúng một ô.
- **Tên máy** luôn đi qua `nodeDisplayName()` ("Mac Mini (máy chính)", "MacBook Air"); id nội bộ `mini`/`air` không
  hiện ra giao diện.
- **Trên điện thoại** (≤ 760 px), thao tác chính của Studio nằm trong thanh dính ở đáy; thao tác phụ vào menu ⋯.
  Vùng chạm tối thiểu 44 px; nút icon nhỏ được mở rộng vùng chạm bằng `::before`.

## 6. Câu chữ (UX copy)

### Thuật ngữ — một khái niệm, một từ

| Dùng | Không dùng trên giao diện |
|---|---|
| **máy**, **máy chính**, **máy phụ** | thiết bị, máy chủ, máy xử lý, worker, backend, node |
| **việc** ("3 việc đang chờ", "Dừng") | tác vụ, job |
| **ảnh và giọng** | media (trừ tên mục "Thư viện media"), audio |
| **video**, hành động **Xuất video** | render, bản xuất; "MP4" chỉ ở nút tải file |
| **kịch bản**, **cảnh** | storyboard, prompt |
| **Bộ tạo giọng** | engine |

Tên máy luôn qua `nodeDisplayName()`. Ollama, OpenAI, LTX chỉ hiện ở Cài đặt, Hệ thống và phần Tùy chọn nâng cao.

### Thông báo lỗi
Khung: **chuyện gì xảy ra + làm gì tiếp**. Mở đầu bằng "Chưa … được" (gợi ý làm lại được), không dùng "Không thể".
Xưng hô dùng "Hãy …", không dùng "Vui lòng". Ví dụ: "Chưa tải ảnh lên được. Hãy dùng ảnh JPG hoặc PNG rồi thử lại."
Câu dùng ở nhiều nơi (chế độ mẫu…) đặt trong `lib/copy.ts`.

### Hộp xác nhận
Dùng `askConfirm()` (`components/ConfirmDialog.tsx`), không dùng `window.confirm`.
- Tiêu đề là câu hỏi về đúng hành động: "Xóa cảnh 3?", không phải "Bạn có chắc?".
- Dòng dưới nói hậu quả: "Lời đọc, ảnh và giọng của cảnh này sẽ mất."
- Hai nút ghi hành động: **Xóa cảnh** / **Giữ lại**; hành động xóa/dừng dùng `tone: "danger"`, focus mặc định ở nút an toàn.

### Trạng thái trống
Khung: **đây là gì + vì sao trống + cách bắt đầu** (kèm nút). Ví dụ: "Chưa có video nào được xuất · Video làm xong
sẽ hiện ở đây, kèm thời lượng và nút tải MP4 · [Tạo video mới]".

### Số và đơn vị
Viết theo kiểu Việt Nam: `0,48 USD`, `1,00×` (dùng `formatUsd`, `formatSpeed`); cảnh báo hệ thống nói vấn đề bằng lời
trước ("Mac Mini thiếu RAM…"), con số kỹ thuật để ở dòng chi tiết.

## 7. Khả năng tiếp cận (WCAG 2.1 AA)

- **Focus:** mọi control dùng `--focus-outline` / `--focus-ring`; không bao giờ `outline: none` mà không thay bằng vòng
  khác. `lib/tokens.test.ts` chặn token tự tham chiếu hoặc chưa định nghĩa (lỗi từng làm mất viền focus toàn site).
- **Viền control** (ô nhập, ô chọn, thẻ lựa chọn) dùng `--line-input`, đạt ≥ 3:1 so với nền ở cả sáng và tối.
- **Mỗi trang:** có `<h1>`; `AppShell` tự đặt tiêu đề tab và chuyển focus vào `<h1>` khi đổi trang; link
  "Bỏ qua tới nội dung" là phần tử đầu tiên.
- **Không lồng control:** một khối bấm được không chứa nút khác (dòng dự án dùng link ở tiêu đề), `<summary>` không
  chứa nút.
- **Lựa chọn một trong nhiều:** `role="radiogroup"` + `role="radio"` + `aria-checked`, phím mũi tên để chuyển.
- **Menu / popover / hộp thoại:** Esc đóng và trả focus về nút mở.
- **Lỗi của một ô:** `aria-invalid` + `aria-describedby` trỏ tới `Notice` có `id`.

## 8. Nên / Không nên

| ✅ Nên | ❌ Không nên |
|---|---|
| `color: var(--text-muted)` | `color: #64748b` |
| `padding: var(--space-3)` hoặc bội số 4 | `padding: 7px 13px` |
| `font-size: var(--text-sm)` | `font-size: 12.5px` |
| `<Notice tone="bad">` cho lỗi | `<Notice tone="warn">` cho lỗi |
| `box-shadow: var(--focus-ring)` khi `:focus-visible` | Tự định nghĩa một vòng focus riêng |
| Dùng `Button` / `Notice` từ `components/ui` | Viết `<button className="…">` với style mới |
