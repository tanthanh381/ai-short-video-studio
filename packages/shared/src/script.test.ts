import { describe, expect, it } from "vitest";
import { cleanScriptForNarration, dropRepeatedText } from "./script";
import { looksLikeSubtitles, subtitlesToScript } from "./srt";

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

describe("pasted subtitles become narration", () => {
  const srt = "1\n00:00:00,000 --> 00:00:04,500\nTrăng treo đầu núi, kiếm khách một mình\n\n2\n00:00:04,500 --> 00:00:09,000\nbước giữa sương khuya.\n\n3\n00:00:09,000 --> 00:00:13,500\n<i>Ba năm trước</i>, hắn thua một trận.\n";
  it("drops numbers, timings and tags and joins a sentence split across cues", () => {
    expect(looksLikeSubtitles(srt)).toBe(true);
    expect(subtitlesToScript(srt)).toBe("Trăng treo đầu núi, kiếm khách một mình bước giữa sương khuya.\nBa năm trước, hắn thua một trận.");
    expect(cleanScriptForNarration(srt)).toBe("Trăng treo đầu núi, kiếm khách một mình bước giữa sương khuya.\nBa năm trước, hắn thua một trận.");
  });

  it("reads WebVTT too, and leaves an ordinary script alone", () => {
    const vtt = "WEBVTT\n\n00:00.000 --> 00:02.000\nXin chào các bạn.\n\n00:02.000 --> 00:04.000\nHôm nay mình kể chuyện.";
    expect(cleanScriptForNarration(vtt)).toBe("Xin chào các bạn.\nHôm nay mình kể chuyện.");
    expect(looksLikeSubtitles("Năm 2024 lúc 10:30 tôi đi học.")).toBe(false);
  });
});

