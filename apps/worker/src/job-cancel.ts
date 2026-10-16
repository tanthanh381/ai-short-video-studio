/** A person pressed "Hủy" while the job was running: stop at the next step, keep what is finished, and do not call it a failure. */
export class JobCancelled extends Error {
  constructor() {
    super("Tác vụ đã được hủy theo yêu cầu. Các cảnh đã hoàn thành được giữ lại.");
    this.name = "JobCancelled";
  }
}

/** The one thing the cancellation check needs from the database client (the worker's Supabase client satisfies it). */
export type JobStatusReader = {
  from(table: "jobs"): {
    select(columns: "status"): { eq(column: "id", value: string): { maybeSingle(): PromiseLike<{ data: { status?: string } | null; error: { message: string } | null }> } };
  };
};

/** True when the job's row says cancelled. A failed read is not a cancellation: the job goes on. */
export async function isCancelled(db: JobStatusReader, jobId: string): Promise<boolean> {
  const { data, error } = await db.from("jobs").select("status").eq("id", jobId).maybeSingle();
  return !error && data?.status === "cancelled";
}

/** Throws JobCancelled when the job was cancelled. */
export async function ensureNotCancelled(db: JobStatusReader, jobId: string): Promise<void> {
  if (await isCancelled(db, jobId)) throw new JobCancelled();
}
