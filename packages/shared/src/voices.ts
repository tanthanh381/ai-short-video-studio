/**
 * Giọng đọc theo thể loại nội dung cho media chạy trên máy.
 * `id` được gửi trong `settings.voice`; local-tools/media_server.py ánh xạ id → giọng + tốc độ.
 */
export const VOICE_PRESETS = [
  { id: "doc-truyen", label: "Đọc truyện", hint: "Nam, giọng Bắc, đều và rõ", sample: "Ngày xưa, ở một làng nhỏ ven sông, có một cậu bé rất thích ngắm sao." },
  { id: "co-trang", label: "Cổ trang / kiếm hiệp", hint: "Nam, kể chuyện, chậm và trầm", sample: "Trăng treo đầu núi, kiếm khách một mình bước giữa sương khuya, áo bay trong gió." },
  { id: "co-trang-nu", label: "Cổ trang / ngôn tình (nữ)", hint: "Nữ, đọc truyện, chậm rãi", sample: "Hoa đào rơi trước hiên cũ, nàng lặng lẽ đợi một người đã hẹn nơi cuối con đường." },
  { id: "triet-ly", label: "Triết lý / suy ngẫm", hint: "Nam, tự nhiên, chậm, nhiều khoảng lặng", sample: "Người khôn không phải người biết nhiều, mà là người biết điều gì đáng để buông bỏ." },
  { id: "tam-su", label: "Tâm sự / chữa lành", hint: "Nữ, tự nhiên, nhẹ nhàng", sample: "Nếu hôm nay bạn thấy mệt, hãy cho phép mình nghỉ một chút. Ngày mai vẫn còn đó." },
  { id: "tin-tuc", label: "Tin tức (nam)", hint: "Nam, rõ ràng, nhanh vừa phải", sample: "Theo thông tin mới nhất, nhiều địa phương đang đẩy nhanh tiến độ các công trình trọng điểm." },
  { id: "tin-tuc-nu", label: "Tin tức (nữ)", hint: "Nữ, rõ ràng, nhanh vừa phải", sample: "Bản tin hôm nay xin gửi đến quý vị những thông tin nổi bật trong ngày." },
  { id: "thuyet-minh", label: "Thuyết minh / kiến thức", hint: "Nam, tự nhiên, dễ nghe", sample: "Bạn có biết, mỗi giây trôi qua, Trái Đất đã di chuyển hàng chục ki-lô-mét quanh Mặt Trời?" },
  { id: "nang-dong", label: "Năng động / quảng cáo", hint: "Nữ, nhịp nhanh", sample: "Ưu đãi chỉ trong hôm nay! Nhanh tay chọn ngay món bạn thích và nhận quà liền tay!" },
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
