import { NodeHttpError } from "./node-errors";

type PexelsPhoto = { src?: { large2x?: string; large?: string; medium?: string }; photographer?: string; url?: string };
type PexelsSearchResponse = { photos?: PexelsPhoto[] };

export type StockImage = { bytes: Uint8Array; contentType: string; sourceUrl: string | null; photographer: string | null };

/** Keep stock queries short and searchable; the full prompt remains the source for the AI image lane. */
export function stockQuery(prompt: string): string {
  return prompt
    .replace(/\b(ultra|high|4k|8k|cinematic|photorealistic|realistic|vertical|portrait|wide|close-up|medium shot|soft lighting|dramatic lighting)\b/giu, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 100) || "people everyday life";
}

export async function fetchPexelsImage(
  prompt: string,
  options: { apiKey?: string; baseUrl: string; aspectRatio: string; signal?: AbortSignal },
): Promise<StockImage> {
  if (!options.apiKey) throw new Error("PEXELS_API_KEY chưa được cấu hình ở worker");
  const query = encodeURIComponent(stockQuery(prompt));
  const orientation = options.aspectRatio === "9:16" ? "portrait" : options.aspectRatio === "16:9" ? "landscape" : "square";
  const response = await fetch(`${options.baseUrl.replace(/\/$/u, "")}/search?query=${query}&orientation=${orientation}&per_page=8`, {
    headers: { Authorization: options.apiKey, accept: "application/json" },
    signal: options.signal ?? AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new NodeHttpError(`Pexels trả lỗi ${response.status}`, response.status);
  const data = (await response.json()) as PexelsSearchResponse;
  const photo = data.photos?.find((item) => item.src?.large2x || item.src?.large || item.src?.medium);
  const imageUrl = photo?.src?.large2x ?? photo?.src?.large ?? photo?.src?.medium;
  if (!imageUrl) throw new Error(`Pexels không tìm thấy ảnh phù hợp cho cảnh: ${stockQuery(prompt)}`);
  const image = await fetch(imageUrl, { signal: options.signal ?? AbortSignal.timeout(30_000) });
  if (!image.ok) throw new NodeHttpError(`Không tải được ảnh Pexels (${image.status})`, image.status);
  return {
    bytes: new Uint8Array(await image.arrayBuffer()),
    contentType: image.headers.get("content-type")?.split(";", 1)[0] || "image/jpeg",
    sourceUrl: photo?.url ?? null,
    photographer: photo?.photographer ?? null,
  };
}
