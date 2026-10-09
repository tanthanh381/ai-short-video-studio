import { describe, expect, it } from "vitest";
import { cleanScriptForNarration, dropRepeatedText } from "./script";

describe("dropRepeatedText", () => {
  const teaser = "Ngày xửa ngày xưa, trong một ngôi làng nhỏ, có hai anh em sống nương tựa vào nhau từ khi cha mẹ mất sớm. Cha mẹ để lại cho họ một ít tài sản...";
  const story = "Ngày xửa ngày xưa, trong một ngôi làng nhỏ, có hai anh em sống nương tựa vào nhau từ khi cha mẹ mất sớm. Cha mẹ để lại cho họ một ít tài sản, đủ để sống yên ổn. Thế nhưng, tính tình của họ rất khác nhau.";

  it("keeps the title, drops a teaser that the full story repeats", () => {
    const pasted = `Ăn khế trả vàng\n${teaser}\n\n${story}\n\nNgười em mừng rỡ.`;
    expect(cleanScriptForNarration(pasted)).toBe(`Ăn khế trả vàng.\n\n${story}\n\nNgười em mừng rỡ.`);
  });

  it("drops a teaser paragraph without a title", () => {
    expect(dropRepeatedText(`${teaser}\n\n${story}`)).toBe(story);
  });

  it("drops a long paragraph pasted twice but keeps a short refrain", () => {
    expect(dropRepeatedText(`${story}\n\n${story}`)).toBe(story);
    const refrain = "Buông bỏ không phải là quên.\n\nMà là bình yên.\n\nBuông bỏ không phải là quên.";
    expect(dropRepeatedText(refrain)).toBe(refrain);
  });

  it("leaves an ordinary script and a heading line untouched", () => {
    const script = "Mở bài\nHãy thật chậm.\n\nCó những thứ càng cố giữ, chúng ta càng đau.";
    expect(dropRepeatedText(script)).toBe(script);
  });
});
