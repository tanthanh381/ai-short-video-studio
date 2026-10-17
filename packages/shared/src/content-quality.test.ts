import { describe, expect, it } from "vitest";
import { evaluateContentQuality } from "./content-quality";

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
  });
});
