/**
 * Giọng đọc theo thể loại nội dung cho media chạy trên máy.
 * `id` được gửi trong `settings.voice`; local-tools/media_server.py ánh xạ id → giọng + tốc độ.
 */
export const VOICE_PRESETS = [
  { id: "doc-truyen", label: "Đọc truyện (nam)", hint: "Nam miền Nam, trầm ấm, nhấn nhá theo câu", sample: "Ngày xưa, ở một làng nhỏ ven sông, có một cậu bé rất thích ngắm sao." },
  { id: "co-trang", label: "Cổ trang / kiếm hiệp (nam)", hint: "Nam miền Bắc, kể chuyện, chậm và giàu khoảng lặng", sample: "Trăng treo đầu núi, kiếm khách một mình bước giữa sương khuya, áo bay trong gió." },
  { id: "co-trang-nu", label: "Cổ trang / ngôn tình (nữ)", hint: "Nữ miền Bắc, mềm và giàu cảm xúc theo từng câu", sample: "Hoa đào rơi trước hiên cũ, nàng lặng lẽ đợi một người đã hẹn nơi cuối con đường." },
  { id: "triet-ly", label: "Triết lý / suy ngẫm (nam)", hint: "Nam miền Nam, chậm, có nhấn ở ý quan trọng", sample: "Người khôn không phải người biết nhiều, mà là người biết điều gì đáng để buông bỏ." },
  { id: "tam-su", label: "Tâm sự / chữa lành (nữ)", hint: "Nữ miền Nam, ấm, có nhịp thở ở câu buồn", sample: "Nếu hôm nay bạn thấy mệt, hãy cho phép mình nghỉ một chút. Ngày mai vẫn còn đó." },
  { id: "tin-tuc", label: "Tin tức (nam)", hint: "Nam miền Bắc, rõ ràng, chuẩn phát thanh viên", sample: "Theo thông tin mới nhất, nhiều địa phương đang đẩy nhanh tiến độ các công trình trọng điểm." },
  { id: "tin-tuc-nu", label: "Tin tức (nữ)", hint: "Nữ miền Bắc, rõ ràng, nhịp bản tin", sample: "Bản tin hôm nay xin gửi đến quý vị những thông tin nổi bật trong ngày." },
  { id: "thuyet-minh", label: "Thuyết minh / kiến thức (nam)", hint: "Nam miền Bắc, tự nhiên, nhấn vào điều cần biết", sample: "Bạn có biết, mỗi giây trôi qua, Trái Đất đã di chuyển hàng chục ki-lô-mét quanh Mặt Trời?" },
  { id: "nang-dong", label: "Năng động / quảng cáo (nam)", hint: "Nam miền Bắc, tươi sáng, nhịp nhanh ở câu kêu gọi", sample: "Ưu đãi chỉ trong hôm nay! Nhanh tay chọn ngay món bạn thích và nhận quà liền tay!" },
  { id: "tre-trung", label: "Trẻ trung / vlog (nữ)", hint: "Nữ miền Bắc, trẻ, tươi, hợp vlog & bắt trend", sample: "Chào cả nhà! Hôm nay mình thử một thứ đang siêu hot, xem có đúng lời đồn không nhé!" },
  { id: "review", label: "Review / phản ứng (nam)", hint: "Nam miền Bắc, trẻ, cuốn, hợp review & reaction", sample: "Mình đã dùng thử suốt một tuần, và thật sự có vài điều khiến mình khá bất ngờ. Xem ngay nào!" },
  { id: "hai-huoc", label: "Hài hước / bắt trend (nam)", hint: "Nam miền Bắc, dí dỏm, tự nhiên như kể cho bạn", sample: "Nói thật nha, lúc đầu mình cũng chẳng tin đâu. Nhưng mà thôi, xem rồi tự hiểu!" },
  { id: "nang-dong-nu", label: "Năng động / quảng cáo (nữ)", hint: "Nữ miền Bắc, tươi sáng, nhịp nhanh ở câu kêu gọi", sample: "Chỉ hôm nay thôi nha! Nhanh tay chốt đơn ngay để không bỏ lỡ ưu đãi cực hời này!" },
  { id: "ke-chuyen-nu", label: "Kể chuyện (nữ)", hint: "Nữ miền Bắc, ấm, truyền cảm theo từng câu", sample: "Có một câu chuyện mà bà tôi hay kể, về một người phụ nữ cả đời chỉ sống vì người khác." },
  { id: "truyen-dem", label: "Truyện đêm khuya (nam)", hint: "Nam miền Bắc, trầm, chậm và nhiều khoảng lặng", sample: "Đã khuya rồi. Nếu bạn vẫn còn thức, hãy để tôi kể bạn nghe một câu chuyện nhỏ." },
  { id: "tam-su-nam", label: "Tâm sự / chữa lành (nam)", hint: "Nam miền Bắc, ấm, nhẹ ở câu buồn", sample: "Đôi khi, mạnh mẽ không phải là không gục ngã, mà là lặng lẽ đứng dậy sau mỗi lần đau." },
  { id: "mien-trung", label: "Giọng miền Trung (nữ)", hint: "Nữ miền Trung, gần gũi và chân chất", sample: "Quê tôi miền Trung, nắng gió quanh năm, nhưng tình người thì ấm áp lạ thường." },
] as const;

export type VoicePresetId = (typeof VOICE_PRESETS)[number]["id"];
export const DEFAULT_VOICE_PRESET: VoicePresetId = "doc-truyen";

export function voiceHint(voice: string): string {
  return VOICE_PRESETS.find((preset) => preset.id === voice)?.hint ?? "";
}

export function isVoicePreset(voice: string): voice is VoicePresetId {
  return VOICE_PRESETS.some((preset) => preset.id === voice);
}

/** Câu mẫu cố định để nghe thử; máy chủ không nhận văn bản tùy ý cho chức năng này. */
export function voiceSample(voice: string): string | null {
  return VOICE_PRESETS.find((preset) => preset.id === voice)?.sample ?? null;
}
