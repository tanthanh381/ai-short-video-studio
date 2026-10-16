import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { imageLooksBlank, looksBlank, pixelSpread } from "./image-check";

describe("blank picture check", () => {
  it("measures the spread of grey levels", () => {
    expect(pixelSpread(new Uint8Array(0))).toBe(0);
    expect(pixelSpread(new Uint8Array([10, 10, 10, 10]))).toBe(0);
    expect(pixelSpread(new Uint8Array([0, 255]))).toBeCloseTo(127.5);
  });
  it("calls a flat frame blank and a detailed one not", () => {
    expect(looksBlank(new Uint8Array(1024).fill(0))).toBe(true);
    expect(looksBlank(new Uint8Array(1024).fill(200).map((_, i) => 200 + (i % 3)))).toBe(true); // near-flat
    expect(looksBlank(new Uint8Array(1024).map((_, i) => (i % 2 ? 40 : 210)))).toBe(false);
    expect(looksBlank(new Uint8Array(0))).toBe(false);
  });
  it("never fails a video: undecodable data or a missing ffmpeg is simply not blank", async () => {
    expect(await imageLooksBlank(new Uint8Array([1, 2, 3]), "ffmpeg")).toBe(false);
    expect(await imageLooksBlank(new Uint8Array([1, 2, 3]), "/no/such/ffmpeg")).toBe(false);
  });
  const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();
  it.skipIf(!hasFfmpeg)("tells a real black PNG from a real picture through ffmpeg", async () => {
    const black = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=black:s=64x64", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"], { maxBuffer: 1e7 });
    const noise = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=s=64x64", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"], { maxBuffer: 1e7 });
    expect(await imageLooksBlank(new Uint8Array(black))).toBe(true);
    expect(await imageLooksBlank(new Uint8Array(noise))).toBe(false);
  });
});
