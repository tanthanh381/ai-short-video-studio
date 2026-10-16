import { spawn } from "node:child_process";

/** Standard deviation of grey levels: a picture that is one flat colour (a black or white frame) has almost none. */
export function pixelSpread(pixels: Uint8Array): number {
  if (!pixels.length) return 0;
  let sum = 0;
  for (const value of pixels) sum += value;
  const mean = sum / pixels.length;
  let squares = 0;
  for (const value of pixels) squares += (value - mean) ** 2;
  return Math.sqrt(squares / pixels.length);
}

/** A 32x32 grey thumbnail with less than this spread carries no picture at all. */
export const BLANK_SPREAD = 4;

export function looksBlank(pixels: Uint8Array): boolean {
  return pixels.length > 0 && pixelSpread(pixels) < BLANK_SPREAD;
}

/** Decodes the picture to a tiny grey thumbnail with ffmpeg. Any trouble answers "not blank": a check must never fail a video. */
export async function imageLooksBlank(image: Uint8Array, ffmpegPath = "ffmpeg", timeoutMs = 15_000): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const chunks: Buffer[] = [];
    let done = false;
    const finish = (value: boolean) => { if (!done) { done = true; resolve(value); } };
    try {
      const child = spawn(ffmpegPath, ["-v", "error", "-i", "pipe:0", "-frames:v", "1", "-vf", "scale=32:32,format=gray", "-f", "rawvideo", "pipe:1"], { stdio: ["pipe", "pipe", "ignore"] });
      const timer = setTimeout(() => { child.kill("SIGKILL"); finish(false); }, timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.on("error", () => { clearTimeout(timer); finish(false); });
      child.on("close", () => { clearTimeout(timer); finish(looksBlank(new Uint8Array(Buffer.concat(chunks)))); });
      child.stdin.on("error", () => undefined);
      child.stdin.end(Buffer.from(image));
    } catch {
      finish(false);
    }
  });
}
