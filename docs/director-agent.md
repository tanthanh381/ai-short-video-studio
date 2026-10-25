# Director-Agent — nâng cấp "Claude điều phối" (lộ trình)

Chuyển dần từ pipeline cố định sang kiến trúc do Claude điều phối (agentic, tool-use).
Triết lý giữ nguyên: **cloud cho phần sáng tạo rẻ (chữ/đánh giá), local cho phần nặng (ảnh/giọng/video, miễn phí)**.

## Hai chế độ ngân sách
- **API mode** (còn ngân sách): các bước cần Claude chạy tự động qua API, trong hạn mức `$`/video.
- **Thủ công / BYO-Claude** (hết/không dùng ngân sách): tự chạy Claude Code tạo kế hoạch–kịch bản rồi dán vào web; hệ thống chỉ chạy media local 0đ. *(UI dán — Phase 2.)*

## Phase 1 — ĐÃ LÀM: QA ảnh bằng Claude vision (thay rule-gate giòn gãy)
Trước: cổng kiểm định ảnh dùng model local nhỏ (qwen2.5vl), hay loại nhầm / kẹt retry.
Giờ: có thể chạy trên **Claude Haiku (đa phương thức)**, trả cùng `ImageQualityAudit` → logic accept/retry/fallback không đổi. **Fail-open**: mọi lỗi/thiếu khóa/vượt cap → tự rơi về qwen local.

### Cờ cấu hình (worker env)
| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `AI_QA_PROVIDER` | `auto` | `auto`=Claude khi owner có khóa, không thì qwen; `claude`=ép Claude; `local`=ép qwen (miễn phí) |
| `ANTHROPIC_VISION_MODEL` | `claude-haiku-5-5` | model vision cho QA |
| `AI_QA_MAX_CLAUDE_CALLS` | `40` | trần số lần QA Claude/video; vượt → rơi về qwen |

- Dùng **khóa Claude của từng owner** (giống bước kịch bản). Không khóa → tự dùng qwen local.
- Chi phí ước tính: ~10–16 lần QA ảnh nhỏ/video ⇒ khoảng **$0.1–0.3/video** (media vẫn 0đ). Muốn 0đ hoàn toàn: đặt `AI_QA_PROVIDER=local`.

## Lộ trình tiếp theo
- **Phase 2**: Director Agent lập `production_plan` (hook/nhịp/phong cách/cảnh nào gắn motion) + platform-aware (TikTok, Reels) + ngân sách cứng + chế độ dán thủ công. *(cần migration: `orchestrator`, `platform`, `production_plan`, log `agent_decisions`.)*
- **Phase 3**: trend ingestion (web search) + A/B hook + ảnh cover.
- **Phase 4**: feedback loop từ chỉ số sau đăng.

Sơ đồ: xem `director-agent.svg` (bản đề xuất đã duyệt).
