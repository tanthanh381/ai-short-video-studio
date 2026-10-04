import { afterEach, describe, expect, it, vi } from "vitest";
import { restoredPreviewTime, signedPreviewIsFresh, SIGNED_PREVIEW_REFRESH_MS, startSignedPreviewRefresh } from "./preview-session";

afterEach(() => vi.useRealTimers());

describe("Signed video preview access", () => {
  it("renews before five-minute expiry without touching the playing source", async () => {
    vi.useFakeTimers();
    const cache = vi.fn();
    const fetchSigned = vi.fn().mockResolvedValue({ url: "renewed-signed-url" });
    const dispose = startSignedPreviewRefresh(fetchSigned, cache);
    await vi.advanceTimersByTimeAsync(SIGNED_PREVIEW_REFRESH_MS - 1);
    expect(fetchSigned).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(cache).toHaveBeenCalledExactlyOnceWith({ url: "renewed-signed-url" });
    dispose();
    await vi.advanceTimersByTimeAsync(SIGNED_PREVIEW_REFRESH_MS);
    expect(fetchSigned).toHaveBeenCalledTimes(1);
  });

  it("does not overlap requests or update an unmounted preview", async () => {
    vi.useFakeTimers();
    let finish!: (value: string) => void;
    const pending = new Promise<string>((resolve) => { finish = resolve; });
    const fetchSigned = vi.fn().mockReturnValue(pending);
    const cache = vi.fn();
    const dispose = startSignedPreviewRefresh(fetchSigned, cache);
    await vi.advanceTimersByTimeAsync(SIGNED_PREVIEW_REFRESH_MS * 2);
    expect(fetchSigned).toHaveBeenCalledTimes(1);
    dispose();
    finish("late signed URL");
    await Promise.resolve();
    expect(cache).not.toHaveBeenCalled();
  });

  it("survives temporary network failures and retries the next refresh", async () => {
    vi.useFakeTimers();
    const fetchSigned = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("fresh");
    const cache = vi.fn();
    const dispose = startSignedPreviewRefresh(fetchSigned, cache);
    await vi.advanceTimersByTimeAsync(SIGNED_PREVIEW_REFRESH_MS * 2);
    expect(cache).toHaveBeenCalledExactlyOnceWith("fresh");
    dispose();
  });

  it("restores position safely when the signed source must be replaced", () => {
    expect(restoredPreviewTime(17.3, 30)).toBe(17.3);
    expect(restoredPreviewTime(32, 30)).toBe(30);
    expect(restoredPreviewTime(-1, 30)).toBe(0);
    expect(restoredPreviewTime(Number.NaN, 30)).toBe(0);
  });

  it("does not reuse old signatures after a background tab wakes up", () => {
    expect(signedPreviewIsFresh(1000, 2000)).toBe(true);
    expect(signedPreviewIsFresh(1000, 1000 + SIGNED_PREVIEW_REFRESH_MS)).toBe(false);
    expect(signedPreviewIsFresh(1000, 1000 + 10 * 60 * 1000)).toBe(false);
    expect(signedPreviewIsFresh(1000, 900)).toBe(false);
  });
});
