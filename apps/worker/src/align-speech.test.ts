import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { alignKnownText, alignSpeechToScript, type WordTimestamp } from "./providers";

type Sample = { engine: string; narration: string; words: WordTimestamp[] };
// 20 real scenes: VieNeu and Piper reading their narration, transcribed by the Whisper base server (2026-10-10).
const samples = JSON.parse(readFileSync(new URL("./fixtures/whisper-misreads.json", import.meta.url), "utf8")) as Sample[];

const heard = (words: string[], gap = 0.4): WordTimestamp[] => words.map((word, i) => ({ word, start: i * gap, end: i * gap + gap - 0.05 }));

describe("aligning the narration to what Whisper heard in an uploaded voice", () => {
  it("the strict alignment rejected every one of 20 real scenes; the tolerant one accepts them all", () => {
    let strict = 0;
    for (const sample of samples) {
      try { alignKnownText(sample.narration, sample.words); strict++; } catch { /* rejected */ }
    }
    expect(strict).toBe(0);
    for (const sample of samples) {
      const result = alignSpeechToScript(sample.narration, sample.words);
      expect(result.matched / result.total, sample.narration).toBeGreaterThanOrEqual(0.4);
      // subtitles are the narration word for word, never Whisper's spelling
      expect(result.words.map((word) => word.word).join(" ")).toBe(sample.narration.trim().replace(/\s+/gu, " "));
    }
  });

  it("every aligned word has a real time, in order, inside the heard speech", () => {
    for (const sample of samples) {
      const { words } = alignSpeechToScript(sample.narration, sample.words);
      let previous = 0;
      for (const word of words) {
        expect(word.end).toBeGreaterThan(word.start);
        expect(word.start).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = word.end;
      }
      expect(words[0]!.start).toBeGreaterThanOrEqual(sample.words[0]!.start - 1e-9);
      // the last word ends within a short moment of the last heard word (a few unheard words share the final gap)
      expect(words.at(-1)!.end).toBeLessThanOrEqual(sample.words.at(-1)!.end + 0.3);
    }
  });

  it("matches the strict result when Whisper heard every word", () => {
    const script = "Đừng gửi mã OTP cho ai.";
    const measured = heard(["đừng", "gửi", "mã", "otp", "cho", "ai"]);
    const tolerant = alignSpeechToScript(script, measured);
    const strict = alignKnownText(script, measured);
    expect(tolerant.words).toEqual(strict.map(({ word, start, end }) => ({ word, start, end })));
    expect(tolerant.matched).toBe(6);
  });

  it("a misheard word keeps the time of its slot", () => {
    const { words } = alignSpeechToScript("Đi nhanh chóng đến chợ.", heard(["đi", "ngành", "trống", "đến", "chợ"]));
    expect(words.map((word) => word.word)).toEqual(["Đi", "nhanh", "chóng", "đến", "chợ."]);
    expect(words[1]!.start).toBeCloseTo(0.4);
    expect(words[2]!.start).toBeCloseTo(0.8);
    expect(words[3]!.start).toBeCloseTo(1.2);
  });

  it("a word Whisper dropped shares the gap between its neighbours; a hallucinated extra word is ignored", () => {
    const dropped = alignSpeechToScript("Hôm nay trời rất đẹp.", [
      { word: "hôm", start: 0, end: 0.3 }, { word: "nay", start: 0.35, end: 0.6 }, { word: "đẹp", start: 1.4, end: 1.8 }]);
    expect(dropped.words.map((word) => word.word)).toEqual(["Hôm", "nay", "trời", "rất", "đẹp."]);
    expect(dropped.words[2]!.start).toBeGreaterThanOrEqual(0.6 - 1e-9);
    expect(dropped.words[3]!.end).toBeLessThanOrEqual(1.4 + 1e-9);
    const extra = alignSpeechToScript("Xin chào.", heard(["ừm", "xin", "chào", "cảm", "ơn"]));
    expect(extra.words.map((word) => word.word)).toEqual(["Xin", "chào."]);
    expect(extra.words[0]!.start).toBeCloseTo(0.4);
  });

  it("splits a word across tone and spelling differences", () => {
    const result = alignSpeechToScript("Đi chậm thôi.", heard(["di", "chậm", "thôi"]));
    expect(result.matched).toBe(3);
  });

  it("rejects an audio that is not this narration, saying so in Vietnamese", () => {
    expect(() => alignSpeechToScript("Hôm nay trời đẹp, chúng ta đi dạo công viên.", heard(["nhạc", "nền", "tiếng", "gió"]))).toThrow(/Audio không khớp lời đọc/);
    expect(() => alignSpeechToScript("Hôm nay trời đẹp.", [])).toThrow(/không nghe ra được từ nào/);
  });

  it("repairs overlapping or invalid timestamps instead of failing the scene", () => {
    const { words } = alignSpeechToScript("Bình tĩnh nhé.", [
      { word: "bình", start: 0, end: 0.6 }, { word: "tĩnh", start: 0.4, end: 0.8 }, { word: "nhé", start: Number.NaN, end: 1 }, { word: "nhé", start: 0.9, end: 1.2 }]);
    expect(words.map((word) => word.word)).toEqual(["Bình", "tĩnh", "nhé."]);
    for (let i = 1; i < words.length; i++) expect(words[i]!.start).toBeGreaterThanOrEqual(words[i - 1]!.end - 1e-9);
  });
});
