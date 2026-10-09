import { describe, expect, it } from "vitest";
import { cleanHashtags, fallbackPostCaption, formatPostCaption, normalizeHashtag } from "./post-caption";

describe("post caption", () => {
  it("writes hashtags without diacritics or spaces and drops junk", () => {
    expect(normalizeHashtag("#Truyện Cổ Tích")).toBe("#truyencotich");
    expect(normalizeHashtag("đời sống")).toBe("#doisong");
    expect(normalizeHashtag("#")).toBe("");
    expect(cleanHashtags(["#Cổ tích", "#cotich", 42, "#x"], "ke-chuyen")).toEqual(["#cotich", "#kechuyen", "#truyenhay"]);
  });

  it("falls back to the opening sentences, the title and style tags", () => {
    const caption = fallbackPostCaption("Ngày xửa ngày xưa có hai anh em. Người anh tham lam. Người em hiền lành.", "Ăn khế trả vàng", "ke-chuyen");
    expect(caption.title).toBe("Ăn khế trả vàng");
    expect(caption.description).toBe("Ngày xửa ngày xưa có hai anh em. Người anh tham lam. Người em hiền lành.");
    expect(formatPostCaption(caption)).toBe(`${caption.description}\n\n#kechuyen #truyenhay`);
  });
});
