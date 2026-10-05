import { describe, expect, it, vi } from "vitest";
import { LocalMediaAdapter } from "./local-media";

describe("LocalMediaAdapter", () => {
  it("gọi đúng các endpoint media local", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2]), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([3, 4]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ words: [{ word: "xin", start: 0, end: 0.3 }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new LocalMediaAdapter("http://host.docker.internal:8765");
    expect(await adapter.createImage("cảnh", "9:16")).toEqual(new Uint8Array([1, 2]));
    expect(await adapter.createSpeech("xin chào", "Linh")).toEqual(new Uint8Array([3, 4]));
    expect(await adapter.transcribe(new Uint8Array([5]))).toEqual([{ word: "xin", start: 0, end: 0.3 }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("chuyển model local đã chọn theo từng tác vụ sang cầu nối", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ words: [{ word: "xin", start: 0, end: 0.3 }] })));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new LocalMediaAdapter("http://localhost:8765");
    const models = { image: "sdxl-turbo", tts: "piper", transcribe: "ggml-base" };
    await adapter.createImage("cảnh", "9:16", models);
    await adapter.createSpeech("xin chào", "co-trang", models);
    await adapter.transcribe(new Uint8Array([5]), models);
    const calls = fetchMock.mock.calls as unknown as Array<[string, { body?: unknown }]>;
    expect(JSON.parse(String(calls[0]![1].body))).toMatchObject({ model: "sdxl-turbo" });
    expect(JSON.parse(String(calls[1]![1].body))).toMatchObject({ engine: "piper", voice: "co-trang" });
    expect(calls[2]![0]).toBe("http://localhost:8765/transcribe?model=ggml-base");
    vi.unstubAllGlobals();
  });

  it("nhận WAV và cue nguyên văn từ audio local đã đo", async () => {
    const text = "Xin chào Việt Nam.\n";
    const audio = Buffer.from("RIFFabcdefghijklWAVEpcm");
    const cues = [{ id: crypto.randomUUID(), text, startMs: 0, endMs: 1537 }];
    const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ audioBase64: audio.toString("base64"), cues, durationMs: 1537 })));
    vi.stubGlobal("fetch", mock);
    expect(await new LocalMediaAdapter("http://localhost:8765").createSpeechAligned(text, "Linh"))
      .toEqual({ audio: new Uint8Array(audio), cues, durationMs: 1537, contentType: "audio/wav" });
    expect(mock.mock.calls[0]![0]).toBe("http://localhost:8765/tts-aligned");
  });

  it.each(["chữ bị nhận sai", "XIN CHÀO VIỆT NAM"])("từ chối cue không nguyên văn: %s", async (text) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      audioBase64: "UklGRmF1ZGlvbWVkaWE=", durationMs: 1000,
      cues: [{ id: crypto.randomUUID(), text, startMs: 0, endMs: 1000 }],
    }))));
    await expect(new LocalMediaAdapter("http://localhost:8765").createSpeechAligned("Xin chào Việt Nam", "Linh")).rejects.toThrow("không bảo toàn");
  });

  it("từ chối cue ngoài audio hoặc chồng nhau", async () => {
    for (const cues of [
      [{ id: crypto.randomUUID(), text: "Xin chào", startMs: 0, endMs: 2000 }],
      [{ id: crypto.randomUUID(), text: "Xin ", startMs: 0, endMs: 700 }, { id: crypto.randomUUID(), text: "chào", startMs: 600, endMs: 1000 }],
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ audioBase64: "UklGRmF1ZGlvbWVkaWE=", cues, durationMs: 1000 }))));
      await expect(new LocalMediaAdapter("http://localhost:8765").createSpeechAligned("Xin chào", "Linh")).rejects.toThrow("Timestamp");
    }
  });

  it("báo lỗi Việt khi bridge trả payload không hợp lệ", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ cues: [] }))));
    await expect(new LocalMediaAdapter("http://localhost:8765").createSpeechAligned("Xin chào", "Linh")).rejects.toThrow("Dịch vụ giọng đọc local");
  });
});
