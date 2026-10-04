import { afterEach, describe, expect, it, vi } from "vitest";
import { completeVideoSubmission, projectIsProcessing, videoSubmission } from "./video-submission";

afterEach(() => vi.unstubAllGlobals());

describe("One-click video submissions", () => {
  it("reuses the key after a lost response and keeps the script out of browser storage", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    const input = { sourceText: "Giữ nguyên dấu tiếng Việt: buổi sáng bình yên." };
    const first = await videoSubmission(input);
    const retry = await videoSubmission(input);
    expect(retry.key).toBe(first.key);
    expect([...values.values()]).not.toContain(input.sourceText);
    completeVideoSubmission(first.storageKey);
    const intentionalNewVideo = await videoSubmission(input);
    expect(intentionalNewVideo.key).not.toBe(first.key);
    completeVideoSubmission(intentionalNewVideo.storageKey);
  });

  it("keeps different scripts and options independent", async () => {
    const first = await videoSubmission({ sourceText: "Kịch bản thứ nhất", settings: { aspectRatio: "9:16" } });
    const other = await videoSubmission({ sourceText: "Kịch bản thứ hai", settings: { aspectRatio: "9:16" } });
    const square = await videoSubmission({ sourceText: "Kịch bản thứ nhất", settings: { aspectRatio: "1:1" } });
    expect(new Set([first.key, other.key, square.key]).size).toBe(3);
    for (const item of [first, other, square]) completeVideoSubmission(item.storageKey);
  });

  it("protects worker-owned project state while queued or running", () => {
    expect(projectIsProcessing([{ status: "queued" }])).toBe(true);
    expect(projectIsProcessing([{ status: "completed" }, { status: "running" }])).toBe(true);
    expect(projectIsProcessing([{ status: "failed" }, { status: "completed" }])).toBe(false);
  });
});
