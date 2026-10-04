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
});
