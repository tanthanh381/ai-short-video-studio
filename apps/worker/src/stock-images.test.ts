import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPexelsImage, stockQuery } from "./stock-images";

describe("stock image provider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("turns a long visual prompt into a short searchable query", () => {
    expect(stockQuery("cinematic realistic vertical portrait of a woman reading a book, soft lighting, 4k")).toBe("of a woman reading a book");
  });

  it("fetches the correctly oriented Pexels image and returns attribution metadata", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ photos: [{ url: "https://pexels.com/photo/1", photographer: "A Creator", src: { large2x: "https://images.pexels.com/1.jpg" } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const result = await fetchPexelsImage("woman reading a book", { apiKey: "pexels-test-key", baseUrl: "https://api.pexels.com/v1", aspectRatio: "9:16" });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("orientation=portrait"), expect.objectContaining({ headers: expect.objectContaining({ Authorization: "pexels-test-key" }) }));
    expect(result.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.photographer).toBe("A Creator");
  });

  it("fails clearly when the key is not configured", async () => {
    await expect(fetchPexelsImage("a quiet room", { baseUrl: "https://api.pexels.com/v1", aspectRatio: "1:1" })).rejects.toThrow("PEXELS_API_KEY");
  });
});
