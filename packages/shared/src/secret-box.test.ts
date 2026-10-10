import { describe, expect, it } from "vitest";
import { cleanApiKey, keyFormatError, lastFour, maskedKey } from "./api-keys";
import { emptyVault, openKey, parseVault, sealKey, summarizeVault, withKey, withoutKey } from "./secret-box";

const SECRET = "test-secret-with-more-than-thirty-two-characters";
const OPENAI_KEY = "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd";
const CLAUDE_KEY = "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-wxyz";

describe("sealing the owner's own API keys", () => {
  it("opens with the same secret, user and provider and gives the key back", () => {
    const sealed = sealKey(SECRET, "user-1", "openai", OPENAI_KEY);
    expect(openKey(SECRET, "user-1", "openai", sealed)).toBe(OPENAI_KEY);
    expect(sealed.last4).toBe("abcd");
  });

  it("never stores the key in the clear and uses a fresh IV every time", () => {
    const a = sealKey(SECRET, "user-1", "openai", OPENAI_KEY);
    const b = sealKey(SECRET, "user-1", "openai", OPENAI_KEY);
    expect(JSON.stringify(a)).not.toContain("AbCdEfGh");
    expect(Buffer.from(a.data, "base64").toString("utf8")).not.toContain("sk-proj");
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });

  it("does not open for another user, another provider, another secret or after tampering", () => {
    const sealed = sealKey(SECRET, "user-1", "openai", OPENAI_KEY);
    const refuse = /Không đọc được khóa API đã lưu/;
    expect(() => openKey(SECRET, "user-2", "openai", sealed)).toThrow(refuse);
    expect(() => openKey(SECRET, "user-1", "anthropic", sealed)).toThrow(refuse);
    expect(() => openKey("another-secret-that-is-also-longer-than-32", "user-1", "openai", sealed)).toThrow(refuse);
    const flipped = Buffer.from(sealed.data, "base64");
    flipped[0] = flipped[0]! ^ 1;
    expect(() => openKey(SECRET, "user-1", "openai", { ...sealed, data: flipped.toString("base64") })).toThrow(refuse);
    expect(() => openKey(SECRET, "user-1", "openai", { ...sealed, tag: Buffer.alloc(16).toString("base64") })).toThrow(refuse);
  });

  it("refuses a secret that is too short, and the error never contains the key", () => {
    let message = "";
    try { sealKey("short", "user-1", "openai", OPENAI_KEY); } catch (error) { message = (error as Error).message; }
    expect(message).toMatch(/ít nhất 32 ký tự/);
    expect(message).not.toContain(OPENAI_KEY);
  });

  it("keeps a vault per user, replaces and removes one provider at a time, and tolerates garbage", () => {
    let vault = withKey(emptyVault(), "openai", sealKey(SECRET, "u", "openai", OPENAI_KEY));
    vault = withKey(vault, "anthropic", sealKey(SECRET, "u", "anthropic", CLAUDE_KEY));
    const reread = parseVault(JSON.stringify(vault));
    expect(openKey(SECRET, "u", "anthropic", reread.keys.anthropic!)).toBe(CLAUDE_KEY);
    expect(summarizeVault(reread, true)).toEqual({
      enabled: true,
      keys: { openai: { saved: true, last4: "abcd", savedAt: reread.keys.openai!.savedAt }, anthropic: { saved: true, last4: "wxyz", savedAt: reread.keys.anthropic!.savedAt } },
    });
    expect(Object.keys(withoutKey(reread, "openai").keys)).toEqual(["anthropic"]);
    for (const garbage of [null, "", "not json", "{}", '{"keys":{"openai":{"iv":1}}}', '{"keys":null}'])
      expect(summarizeVault(parseVault(garbage), false).keys).toEqual({ openai: { saved: false }, anthropic: { saved: false } });
  });

  it("the summary the website receives carries no part of the key but its last four characters", () => {
    const vault = withKey(emptyVault(), "openai", sealKey(SECRET, "u", "openai", OPENAI_KEY));
    const shown = JSON.stringify(summarizeVault(vault, true));
    expect(shown).not.toContain("sk-proj");
    expect(shown).not.toContain("AbCdEfGh");
    expect(shown).toContain("abcd");
  });
});

describe("checking a pasted key before anything is sent", () => {
  it("accepts a well-formed key of each provider and cleans pasted quotes and spaces", () => {
    expect(keyFormatError("openai", OPENAI_KEY)).toBeNull();
    expect(keyFormatError("anthropic", CLAUDE_KEY)).toBeNull();
    expect(cleanApiKey(`  "${OPENAI_KEY}"\n`)).toBe(OPENAI_KEY);
    expect(keyFormatError("openai", `"${OPENAI_KEY}" `)).toBeNull();
  });

  it("says in Vietnamese what is wrong, without echoing the key", () => {
    expect(keyFormatError("openai", "")).toMatch(/dán khóa API/);
    expect(keyFormatError("openai", "sk-abc def-ghi-jkl-mno-pqr-stu-vwx-yz0")).toMatch(/không có khoảng trắng/);
    expect(keyFormatError("openai", "hunter2-hunter2-hunter2-hunter2-hunter2")).toMatch(/bắt đầu bằng "sk-"/);
    expect(keyFormatError("anthropic", OPENAI_KEY)).toMatch(/bắt đầu bằng "sk-ant-"/);
    expect(keyFormatError("openai", CLAUDE_KEY)).toMatch(/khóa của Claude/);
    expect(keyFormatError("openai", "sk-short")).toMatch(/độ dài/);
    expect(keyFormatError("openai", "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789$%^")).toMatch(/chỉ gồm chữ, số/);
    for (const bad of ["sk-short", "hunter2-hunter2-hunter2-hunter2-hunter2"]) expect(keyFormatError("openai", bad)).not.toContain(bad);
  });

  it("masks a stored key as its last four characters", () => {
    expect(lastFour(` ${OPENAI_KEY} `)).toBe("abcd");
    expect(maskedKey({ saved: true, last4: "wxyz" })).toBe("…wxyz");
    expect(maskedKey({ saved: false })).toBe("");
  });
});
