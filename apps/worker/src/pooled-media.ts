import type { Lane } from "./node-plan";
import type { DistributeOptions, NodePool, NodeRef, Outcome } from "./node-pool";
import { LocalMediaAdapter } from "./local-media";
import type { MediaModelOptions, MediaProvider, WordTimestamp } from "./providers";

/**
 * The local media provider when more than one Mac can do the work: every single call goes to the machine the balancer
 * picks (and moves to another if that one cannot be reached), and `distribute` spreads a batch of scenes over them.
 * With one machine it is the same adapter as before.
 */
export class PooledMediaAdapter implements MediaProvider {
  private readonly adapters = new Map<string, LocalMediaAdapter>();

  constructor(private readonly pool: NodePool) {}

  /** The adapter that talks to one particular machine. */
  on(id: string): LocalMediaAdapter {
    let adapter = this.adapters.get(id);
    if (!adapter) {
      const spec = this.pool.spec(id);
      adapter = new LocalMediaAdapter(spec.mediaUrl, {
        ...(spec.token ? { token: spec.token } : {}),
        downSignal: () => this.pool.downSignal(id),
      });
      this.adapters.set(id, adapter);
    }
    return adapter;
  }

  get distributed(): boolean {
    return this.pool.distributed;
  }

  createImage(prompt: string, aspectRatio: string, models: MediaModelOptions = {}): Promise<Uint8Array> {
    return this.pool.runOne("image", (node) => this.on(node.id).createImage(prompt, aspectRatio, models), { imageModel: models.image ?? null });
  }

  createVideo(input: { image: Uint8Array; prompt: string; aspectRatio: string }, models: MediaModelOptions = {}): Promise<Uint8Array> {
    return this.pool.runOne("video", (node) => this.on(node.id).createVideo(input, models));
  }

  createSpeech(text: string, voice: string, models: MediaModelOptions = {}): Promise<Uint8Array> {
    return this.pool.runOne("tts", (node) => this.on(node.id).createSpeech(text, voice, models), { ttsEngine: models.tts ?? null });
  }

  createSpeechAligned(text: string, voice: string, models: MediaModelOptions = {}) {
    return this.pool.runOne("tts", (node) => this.on(node.id).createSpeechAligned(text, voice, models), { ttsEngine: models.tts ?? null });
  }

  transcribe(audio: Uint8Array, models: MediaModelOptions = {}): Promise<WordTimestamp[]> {
    return this.pool.runOne("transcribe", (node) => this.on(node.id).transcribe(audio, models));
  }

  /** Runs `work` for every item on the machines the balancer selects; see NodePool.distribute. */
  distribute<T, R>(
    lane: Lane,
    items: T[],
    work: (item: T, media: LocalMediaAdapter, node: NodeRef, index: number) => Promise<R>,
    options: DistributeOptions<T> = {},
  ): Promise<Array<Outcome<R>>> {
    return this.pool.distribute(lane, items, (item, node, index) => work(item, this.on(node.id), node, index), options);
  }
}
