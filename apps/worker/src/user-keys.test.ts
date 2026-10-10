import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sealKey, emptyVault, withKey, withoutKey, VAULT_BUCKET, vaultPath } from "@studio/shared/secret-box";
import { loadUserKey } from "./user-keys";
import { AnthropicStoryboardAdapter } from "./anthropic";
import { OpenAIAdapter, providerErrorMessage } from "./openai";

const SECRET = "a-test-secret-that-is-longer-than-thirty-two-characters";
const OPENAI_KEY = "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd";
const CLAUDE_KEY = "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-wxyz";

/** What the real Supabase client returns for a file that is not there: HTTP 400, message "{}", the 404 only in the body. */
const missingObjectError = () => ({
  name: "StorageUnknownError",
  message: "{}",
  originalError: new Response(JSON.stringify({ statusCode: "404", error: "not_found", message: "Object not found", code: "NoSuchKey" }), { status: 400 }),
});

/** A Supabase client whose storage holds the vault files given. */
const storageWith = (files: Record<string, string>, failure?: { message: string; statusCode?: string }) =>
  ({ storage: { from: (bucket: string) => ({ download: async (path: string) => {
    if (failure) return { data: null, error: failure };
    const text = files[`${bucket}/${path}`];
    return text === undefined ? { data: null, error: missingObjectError() } : { data: { text: async () => text }, error: null };
  } }) } }) as never;

describe("opening the owner's own key for a job", () => {
  const vault = withKey(withKey(emptyVault(), "openai", sealKey(SECRET, "user-1", "openai", OPENAI_KEY)), "anthropic", sealKey(SECRET, "user-1", "anthropic", CLAUDE_KEY));
  const files = { [`${VAULT_BUCKET}/${vaultPath("user-1")}`]: JSON.stringify(vault) };

  it("gives the plain key of the right provider", async () => {
    expect(await loadUserKey(storageWith(files), SECRET, "user-1", "openai")).toBe(OPENAI_KEY);
    expect(await loadUserKey(storageWith(files), SECRET, "user-1", "anthropic")).toBe(CLAUDE_KEY);
  });

  it("gives null when no key was saved: no file, no such provider, or no server secret", async () => {
    expect(await loadUserKey(storageWith({}), SECRET, "user-1", "openai")).toBeNull();
    const onlyClaude = { [`${VAULT_BUCKET}/${vaultPath("user-1")}`]: JSON.stringify(withoutKey(vault, "openai")) };
    expect(await loadUserKey(storageWith(onlyClaude), SECRET, "user-1", "openai")).toBeNull();
    expect(await loadUserKey(storageWith(files), undefined, "user-1", "openai")).toBeNull();
  });

  it("never opens another owner's key, and says what to do when the secret changed", async () => {
    expect(await loadUserKey(storageWith({}), SECRET, "user-2", "openai")).toBeNull();
    const copied = { [`${VAULT_BUCKET}/${vaultPath("user-2")}`]: JSON.stringify(vault) }; // user-1's file copied to user-2
    await expect(loadUserKey(storageWith(copied), SECRET, "user-2", "openai")).rejects.toThrow(/Hãy nhập lại khóa ở Cài đặt/);
    await expect(loadUserKey(storageWith(files), "a-different-secret-that-is-also-longer-than-32", "user-1", "openai")).rejects.toThrow(/Hãy nhập lại khóa ở Cài đặt/);
  });

  it("a storage failure is not mistaken for 'no key' (it would send the job to the shared key)", async () => {
    await expect(loadUserKey(storageWith({}, { message: "gateway timeout", statusCode: "504" }), SECRET, "user-1", "openai")).rejects.toThrow(/Không đọc được khóa API/);
  });
});

describe("calling the providers with the owner's key", () => {
  const servers: Array<ReturnType<typeof createServer>> = [];
  afterEach(() => { servers.forEach((server) => server.close()); servers.length = 0; vi.unstubAllGlobals(); });

  async function fakeProvider(handler: (path: string, headers: Record<string, string | string[] | undefined>, body: string) => { status: number; json?: unknown }) {
    const seen: Array<{ path: string; headers: Record<string, string | string[] | undefined>; body: string }> = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        seen.push({ path: req.url ?? "", headers: req.headers, body });
        const answer = handler(req.url ?? "", req.headers, body);
        res.writeHead(answer.status, { "content-type": "application/json", "x-request-id": "req_test" });
        res.end(JSON.stringify(answer.json ?? {}));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
  }

  it("OpenAI: the owner's key goes in the Authorization header to the configured address, for images and speech too", async () => {
    const provider = await fakeProvider((path) => path.endsWith("/images/generations")
      ? { status: 200, json: { data: [{ b64_json: Buffer.from("png-bytes").toString("base64") }] } }
      : { status: 200 });
    const adapter = new OpenAIAdapter(OPENAI_KEY, { text: "t", image: "gpt-image", tts: "tts" }, `${provider.url}/v1/`);
    const image = await adapter.createImage("a quiet street", "9:16");
    expect(Buffer.from(image).toString()).toBe("png-bytes");
    await adapter.createSpeech("Xin chào", "alloy");
    expect(provider.seen.map((call) => call.path)).toEqual(["/v1/images/generations", "/v1/audio/speech"]);
    for (const call of provider.seen) expect(call.headers.authorization).toBe(`Bearer ${OPENAI_KEY}`);
    expect(JSON.parse(provider.seen[0]!.body)).toMatchObject({ model: "gpt-image", size: "1024x1536" });
  });

  it("Claude: the owner's key goes in x-api-key to the configured address", async () => {
    const storyboard = { hook: "Mở đầu", narration: "Một câu chuyện.", suggestedTitle: "t", suggestedDescription: "d", scenes: [{ narration: "Một câu chuyện.", imagePrompt: "A quiet street at dawn with a lone walker", estimatedDurationMs: 4000 }] };
    const provider = await fakeProvider(() => ({ status: 200, json: { id: "msg_1", type: "message", role: "assistant", model: "m", content: [{ type: "text", text: JSON.stringify(storyboard) }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } } }));
    const adapter = new AnthropicStoryboardAdapter(CLAUDE_KEY, "claude-haiku", provider.url);
    const result = await adapter.createStoryboard({ title: "t", sourceText: "Một câu chuyện ngắn.", inputMode: "full-script", rewrite: false, audience: "a", style: "ke-chuyen", duration: 30, visualStyle: "v" });
    expect(result.scenes).toHaveLength(1);
    expect(provider.seen[0]!.path).toBe("/v1/messages");
    expect(provider.seen[0]!.headers["x-api-key"]).toBe(CLAUDE_KEY);
  });

  it("a refused key gets a message that says what to do and never contains the key", async () => {
    const provider = await fakeProvider(() => ({ status: 401, json: { error: { message: `Incorrect API key provided: ${OPENAI_KEY}` } } }));
    const adapter = new OpenAIAdapter(OPENAI_KEY, { text: "t", image: "i", tts: "s" }, provider.url);
    const error = await adapter.createImage("p", "1:1").catch((caught: Error) => caught);
    expect((error as Error).message).toMatch(/OpenAI từ chối khóa API của bạn.*platform\.openai\.com.*Cài đặt/);
    expect((error as Error).message).not.toContain(OPENAI_KEY);
    expect((error as Error).message).toContain("req_test");
  });

  it("says what each provider status means", () => {
    expect(providerErrorMessage("Claude", "console.anthropic.com", 401)).toMatch(/từ chối khóa API/);
    expect(providerErrorMessage("Claude", "console.anthropic.com", 403)).toMatch(/không có quyền/);
    expect(providerErrorMessage("OpenAI", "platform.openai.com", 429)).toMatch(/hết số dư hoặc vượt giới hạn/);
    expect(providerErrorMessage("OpenAI", "platform.openai.com", 402)).toMatch(/hết số dư/);
    expect(providerErrorMessage("OpenAI", "platform.openai.com", 503)).toMatch(/sự cố/);
    expect(providerErrorMessage("OpenAI", "platform.openai.com", 418)).toBe("OpenAI API trả lỗi 418");
  });
});
