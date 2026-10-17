import { describe, expect, it } from "vitest";
import { extractJsonObject, parseTrendIdeas, vietnamNow } from "./trends";

describe("vietnamNow", () => {
  it("returns the Asia/Ho_Chi_Minh date and hour (UTC+7)", () => {
    // 2026-01-01T23:30Z is 2026-01-02 06:30 in Vietnam.
    expect(vietnamNow(new Date("2026-01-01T23:30:00Z"))).toEqual({ date: "2026-01-02", hour: 6 });
    expect(vietnamNow(new Date("2026-01-02T00:05:00Z")).hour).toBe(7);
  });
});

describe("extractJsonObject", () => {
  it("reads a fenced json block", () => {
    expect(extractJsonObject('Đây là kết quả:\n```json\n{"ideas":[]}\n```\nhết')).toEqual({ ideas: [] });
  });
  it("reads a bare object wrapped in prose", () => {
    expect(extractJsonObject('xin chào {"ideas":[{"title":"a"}]} tạm biệt')).toMatchObject({ ideas: [{ title: "a" }] });
  });
  it("throws when there is no object", () => {
    expect(() => extractJsonObject("không có json ở đây")).toThrow();
  });
});

describe("parseTrendIdeas", () => {
  const idea = {
    niche: "kien-thuc", title: "Vì sao nên kiểm tra tin nhắn chuyển tiền", hook: "Một tin nhắn giục có thể khiến bạn mất tiền",
    angle: "góc nhìn", whyTrending: "lừa đảo chuyển khoản đang nóng", scriptOutline: ["mở", "thân", "chốt"],
    hashtags: ["#luadao", "#chuyenkhoan"], platform: "TikTok", durationSec: 45,
  };
  it("keeps well-formed ideas and normalizes an unknown niche to kien-thuc", () => {
    const ideas = parseTrendIdeas({ ideas: [idea, { ...idea, niche: "khong-ton-tai" }] });
    expect(ideas).toHaveLength(2);
    expect(ideas[1]!.niche).toBe("kien-thuc");
  });
  it("keeps a valid niche as-is and drops malformed entries", () => {
    const ideas = parseTrendIdeas({ ideas: [{ ...idea, niche: "co-tich" }, { title: "" }, "rác"] });
    expect(ideas).toHaveLength(1);
    expect(ideas[0]!.niche).toBe("co-tich");
  });
  it("returns [] when there are no ideas", () => {
    expect(parseTrendIdeas({})).toEqual([]);
  });
});
