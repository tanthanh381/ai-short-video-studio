import { describe, expect, it } from "vitest";
import { parseBatchIdeas } from "./batch";

describe("batch ideas", () => {
  it("keeps each blank-line separated idea independent", () => {
    expect(parseBatchIdeas("Một ý tưởng đủ dài.\n\n  Ý tưởng thứ hai cũng đủ dài. ")).toEqual([
      "Một ý tưởng đủ dài.",
      "Ý tưởng thứ hai cũng đủ dài.",
    ]);
  });

  it("ignores too-short entries and caps queue size", () => {
    expect(parseBatchIdeas("ngắn\n\nMột ý tưởng hợp lệ đây.", 1)).toEqual(["Một ý tưởng hợp lệ đây."]);
  });
});
