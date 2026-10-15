import type { Project } from "@studio/shared";
import { rebaseEdits } from "./project-merge";

/** "unsaved": edits waiting for the person to press Save (auto-save off); "saving": being written; "error": the write failed. */
export type SaveState = { status: "saved" | "saving" | "unsaved" | "error"; message?: string };

/** A save refused because the project changed on the server after this copy was loaded (HTTP 409 "đã được cập nhật"). */
export function isStaleSave(error: unknown): boolean {
  const failure = error as { status?: number; message?: string } | null;
  return failure?.status === 409 && /đã được cập nhật/u.test(failure.message ?? "");
}

/**
 * Keeps the studio's edits safe on the server. Edits are queued and written one after another; every write carries the
 * newest `updatedAt` this page has seen (its own previous save included), so typing through a save never collides with
 * itself; if the server moved on by itself (a finished job), the edit is rebased onto the new copy and written again.
 */
export class ProjectSaver {
  private confirmed: Project | null = null;
  private pending: Project | null = null;
  private running: Promise<void> | null = null;

  constructor(private readonly deps: {
    save(project: Project): Promise<Project>;
    load(): Promise<Project>;
    /** Called with the server's copy once a save left nothing newer waiting. */
    onSaved(project: Project): void;
    onState(state: SaveState): void;
  }) {}

  /** The newest copy known to be on the server (after a load, a poll or a save). */
  confirm(project: Project) {
    this.confirmed = project;
  }

  /** Queues an edit. With `auto` off it only waits (the page shows "unsaved") until flush() is called. */
  edit(project: Project, auto = true) {
    this.pending = project;
    this.deps.onState({ status: auto ? "saving" : "unsaved" });
  }

  get hasPending() {
    return this.pending !== null || this.running !== null;
  }

  /** Resolves when every queued edit is on the server; throws (keeping the edit queued) when one cannot be saved. */
  async flush(): Promise<void> {
    while (this.running || this.pending) {
      if (this.running) {
        await this.running;
        continue;
      }
      this.deps.onState({ status: "saving" });
      this.running = this.drain();
      try { await this.running; } finally { this.running = null; }
    }
  }

  private async drain() {
    while (this.pending) {
      let next = this.pending;
      this.pending = null;
      for (let attempt = 0; ; attempt++) {
        try {
          const updated = await this.deps.save(this.confirmed ? { ...next, updatedAt: this.confirmed.updatedAt } : next);
          this.confirmed = updated;
          if (!this.pending) {
            this.deps.onSaved(updated);
            this.deps.onState({ status: "saved" });
          }
          break;
        } catch (error) {
          if (isStaleSave(error) && attempt < 2 && this.confirmed) {
            const base = this.confirmed;
            const latest = await this.deps.load();
            next = rebaseEdits(base, next, latest);
            if (this.pending) this.pending = rebaseEdits(base, this.pending, latest);
            this.confirmed = latest;
            continue;
          }
          this.pending ??= next;
          this.deps.onState({ status: "error", message: error instanceof Error ? error.message : "Chưa lưu được chỉnh sửa." });
          throw error;
        }
      }
    }
  }
}
