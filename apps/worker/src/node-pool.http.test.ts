import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { NodePool, createProbe, parseNodeSpecs } from "./node-pool";
import { PooledMediaAdapter } from "./pooled-media";

/** A stand-in for a Mac's media bridge, hand-drawing server and Ollama, on real sockets. */
type FakeMac = {
  server: Server;
  port: number;
  requests: Array<{ path: string; authorization?: string }>;
  /** What /image does: wait this long, then answer with PNG bytes. */
  imageMs: number;
  dropImages: boolean;
  token?: string;
  fingerprint: string;
};

const macs: FakeMac[] = [];
const sockets = new Set<import("node:net").Socket>();

async function startMac(over: Partial<FakeMac> = {}): Promise<FakeMac> {
  const mac: FakeMac = { server: createServer(), port: 0, requests: [], imageMs: 100, dropImages: false, fingerprint: "same", ...over };
  const json = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  mac.server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  mac.server.on("request", (request: IncomingMessage, response: ServerResponse) => {
    const path = (request.url ?? "").split("?")[0]!;
    const authorization = request.headers.authorization;
    mac.requests.push({ path, ...(authorization ? { authorization } : {}) });
    const authorised = !mac.token || authorization === `Bearer ${mac.token}`;
    if (path === "/health") return json(response, 200, { ok: true });
    if (path === "/api/tags") return json(response, 200, { models: [{ name: "qwen3.5:4b" }] });
    if (path === "/api/ps") return json(response, 200, { models: [] });
    if (!authorised) return json(response, 401, { error: "token" });
    if (path === "/node-status") {
      return json(response, 200, {
        accepting: true,
        capabilities: { image: true, tts: true, transcribe: true, video: false },
        image: { state: "ready", models: ["sdxl-turbo"], defaultModel: "sdxl-turbo" },
        tts: { engines: ["vieneu"], defaultEngine: "vieneu" },
        resources: { cpuCores: 8, memTotalGb: 16, memPressure: "normal", loadAvg1: 0.5, power: "ac", batteryPercent: null, thermal: "nominal" },
        perf: { image: mac.imageMs },
        fingerprint: mac.fingerprint,
      });
    }
    if (path === "/image") {
      request.resume();
      if (mac.dropImages) {
        setTimeout(() => request.socket.destroy(), 30);
        return;
      }
      setTimeout(() => {
        response.writeHead(200, { "content-type": "image/png" });
        response.end(Buffer.from([137, 80, 78, 71, 1]));
      }, mac.imageMs);
      return;
    }
    json(response, 404, {});
  });
  await new Promise<void>((resolve) => mac.server.listen(0, "127.0.0.1", resolve));
  mac.port = (mac.server.address() as AddressInfo).port;
  macs.push(mac);
  return mac;
}

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  await Promise.all(macs.splice(0).map((mac) => new Promise<void>((resolve) => mac.server.close(() => resolve()))));
});

function poolFor(mini: FakeMac, air: FakeMac, token = "shared-token", mode: "auto" | "parallel" = "parallel") {
  const base = (mac: FakeMac) => `http://127.0.0.1:${mac.port}`;
  const specs = parseNodeSpecs({
    AI_NODES: `air=127.0.0.1:${air.port}`, AI_NODES_TOKEN: token, AI_PRIMARY_NODE: "mini",
    LOCAL_MEDIA_BASE_URL: base(mini), OLLAMA_BASE_URL: base(mini), WHITEBOARD_SERVER_URL: base(mini),
  });
  // The second machine's Ollama and drawing server live on the standard ports in real life; here they share the one port.
  specs[1] = { ...specs[1]!, ollamaUrl: base(air), whiteboardUrl: base(air) };
  const pool = new NodePool(specs, { mode, strict: true, minBatteryPercent: 30, probe: createProbe(fetch, 1_500), cooldownMs: 5_000 });
  return { pool, media: new PooledMediaAdapter(pool) };
}

describe("two machines over real HTTP", () => {
  it("probes both, sends the token to the second, and spreads pictures over them", async () => {
    const mini = await startMac({ imageMs: 300 });
    const air = await startMac({ imageMs: 400, token: "shared-token" });
    const { pool, media } = poolFor(mini, air);
    await pool.probeAll();
    expect(pool.summary().nodes.map((node) => [node.id, node.state])).toEqual([["mini", "healthy"], ["air", "healthy"]]);

    const started = Date.now();
    const outcomes = await media.distribute("image", Array.from({ length: 8 }, (_, i) => i), (_item, adapter) => adapter.createImage("một cảnh", "9:16"));
    const took = Date.now() - started;
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    const served = (mac: FakeMac) => mac.requests.filter((request) => request.path === "/image").length;
    expect(served(mini) + served(air)).toBe(8);
    expect(served(air)).toBeGreaterThanOrEqual(2);
    expect(served(mini)).toBeGreaterThan(served(air));
    expect(took).toBeLessThan(8 * 300 * 0.85); // 2.4 s on the main machine alone
    // The token went to the second machine's bridge, never to the main one's.
    expect(air.requests.filter((request) => request.path === "/image").every((request) => request.authorization === "Bearer shared-token")).toBe(true);
    expect(mini.requests.every((request) => request.authorization === undefined)).toBe(true);
    pool.stop();
  }, 20_000);

  it("finishes the batch on the main machine when the second one drops the connection mid-request", async () => {
    const mini = await startMac({ imageMs: 200 });
    const air = await startMac({ imageMs: 200, token: "shared-token", dropImages: true });
    const { pool, media } = poolFor(mini, air);
    await pool.probeAll();
    const outcomes = await media.distribute("image", Array.from({ length: 6 }, (_, i) => i), (_item, adapter) => adapter.createImage("một cảnh", "9:16"));
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(outcomes.every((outcome) => outcome.ok && outcome.nodeId === "mini")).toBe(true);
    expect(air.requests.filter((request) => request.path === "/image")).toHaveLength(1); // tried once, then left alone
    pool.stop();
  }, 20_000);

  it("does not use a machine that rejects the token, and says why", async () => {
    const mini = await startMac({ imageMs: 100 });
    const air = await startMac({ imageMs: 100, token: "the-real-token" });
    const { pool, media } = poolFor(mini, air, "wrong-token");
    await pool.probeAll();
    const summary = pool.summary().nodes.find((node) => node.id === "air")!;
    expect(summary.state).not.toBe("healthy");
    expect(summary.detail).toMatch(/token/);
    const outcomes = await media.distribute("image", [0, 1, 2], (_item, adapter) => adapter.createImage("một cảnh", "9:16"));
    expect(outcomes.every((outcome) => outcome.ok && outcome.nodeId === "mini")).toBe(true);
    expect(air.requests.filter((request) => request.path === "/image")).toHaveLength(0);
    pool.stop();
  }, 20_000);

  it("keeps pictures off a machine whose settings differ, even though it is fast", async () => {
    const mini = await startMac({ imageMs: 200 });
    const air = await startMac({ imageMs: 50, token: "shared-token", fingerprint: "other-steps" });
    const { pool, media } = poolFor(mini, air);
    await pool.probeAll();
    const outcomes = await media.distribute("image", [0, 1, 2, 3], (_item, adapter) => adapter.createImage("một cảnh", "9:16"));
    expect(outcomes.every((outcome) => outcome.ok && outcome.nodeId === "mini")).toBe(true);
    expect(pool.summary().nodes.find((node) => node.id === "air")!.detail).toMatch(/khác máy chính/);
    pool.stop();
  }, 20_000);

  it("a single call goes to the main machine, and to the other one if the main one is gone", async () => {
    const mini = await startMac({ imageMs: 50 });
    const air = await startMac({ imageMs: 50, token: "shared-token" });
    const { pool, media } = poolFor(mini, air, "shared-token", "auto");
    await pool.probeAll();
    await media.createImage("một cảnh", "9:16");
    expect(mini.requests.filter((request) => request.path === "/image")).toHaveLength(1);
    await new Promise<void>((resolve) => mini.server.close(() => resolve()));
    for (const socket of sockets) socket.destroy();
    const image = await media.createImage("một cảnh", "9:16");
    expect(image).toEqual(new Uint8Array([137, 80, 78, 71, 1]));
    expect(air.requests.filter((request) => request.path === "/image")).toHaveLength(1);
    pool.stop();
  }, 20_000);
});
