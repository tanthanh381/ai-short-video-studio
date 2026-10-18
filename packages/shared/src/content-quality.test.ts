import { describe, expect, it } from "vitest";
import { evaluateContentQuality, passesIdeaQuality } from "./content-quality";

describe("content quality gate", () => {
  it("flags generic openings before media generation", () => {
    const report = evaluateContentQuality("Xin chào các bạn. Trong video này chúng ta sẽ tìm hiểu một điều.");
    expect(report.score).toBeLessThan(45);
    expect(report.feedback.join(" ")).toMatch(/chung chung/u);
  });

  it("rewards a concrete hook, development and ending", () => {
    const report = evaluateContentQuality("Vì sao tin nhắn càng gấp càng dễ khiến bạn mất tiền? Hãy dừng 30 giây và gọi lại số chính thức. Ví dụ, một đường link lạ có thể dẫn tới trang giả. Hãy nhớ: kiểm tra trước khi chuyển.");
    expect(report.score).toBeGreaterThanOrEqual(70);
    expect(report.feedback).toHaveLength(0);
    expect(report.dimensions.hook.score).toBeGreaterThanOrEqual(80);
    expect(report.dimensions.specificity.score).toBeGreaterThanOrEqual(80);
    expect(report.dimensions.ending.score).toBeGreaterThanOrEqual(80);
    expect(report.dimensions.visualAction.score).toBeGreaterThanOrEqual(80);
  });

  it("recognizes a contrast hook without requiring a question mark", () => {
    const report = evaluateContentQuality("Một câu trả lời trôi chảy vẫn có thể sai. Hãy kiểm tra nguồn trước khi tin.");
    expect(report.dimensions.hook.score).toBeGreaterThanOrEqual(80);
  });

  it("treats newline-delimited creator beats as structure", () => {
    const report = evaluateContentQuality([
      "Một câu trả lời trôi chảy vẫn có thể sai",
      "Hãy kiểm tra nguồn trước khi tin",
      "Ví dụ, đối chiếu ngày và tác giả trước khi chia sẻ",
      "Hãy nhớ: chậm một nhịp để chắc hơn",
    ].join("\n"));
    expect(report.dimensions.structure.score).toBeGreaterThanOrEqual(78);
    expect(report.score).toBeGreaterThanOrEqual(80);
  });

  it("flags a script that gives the image model no visible action", () => {
    const report = evaluateContentQuality("Sự bình yên là một trạng thái sâu sắc. Mọi thứ rồi sẽ ổn. Hãy nhớ điều đó.");
    expect(report.dimensions.visualAction.score).toBeLessThan(50);
    expect(report.feedback.join(" ")).toMatch(/hành động hoặc đạo cụ/u);
  });

  it("requires the core editorial dimensions before an idea can enter media generation", () => {
    const weak = evaluateContentQuality("Mọi thứ rồi sẽ ổn. Hãy nghĩ tích cực và cố gắng mỗi ngày.");
    const strong = evaluateContentQuality("Vì sao bạn vẫn mệt dù đã ngủ đủ 8 giờ? Khi buổi chiều đến, hãy tắt thông báo trong 10 phút. Ví dụ, ghi lại một việc đang làm bạn quá tải. Hãy nhớ, năng lượng không chỉ đến từ giấc ngủ.");
    expect(passesIdeaQuality(weak)).toBe(false);
    expect(passesIdeaQuality(strong)).toBe(true);
  });
});
