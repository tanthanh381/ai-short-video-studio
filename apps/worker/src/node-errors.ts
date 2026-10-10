/** The node was declared down (or went silent) while a request was in flight; the request is aborted with this. */
export class NodeDownError extends Error {
  constructor(readonly nodeId: string) {
    super(`Máy ${nodeId} mất kết nối`);
    this.name = "NodeDownError";
  }
}

/** A node answered with an HTTP error. The message stays the text the owner already sees today. */
export class NodeHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "NodeHttpError";
  }
}

const NETWORK_CODES = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "ENOTFOUND", "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT",
]);

const FATAL = Symbol("studio.not-the-machines-fault");

/**
 * Tags an error from the work done around a machine's answer (saving it, uploading it) so the balancer does not blame
 * the machine for it: a database outage must not mark a healthy Mac as down and redo its picture elsewhere.
 */
export function markFatal<T>(error: T): T {
  if (typeof error === "object" && error !== null) {
    (error as { [FATAL]?: true })[FATAL] = true; // the very same object comes back: callers see what they saw before
    return error;
  }
  return markFatal(new Error(String(error))) as T;
}

/**
 * unreachable: the machine (not the request) is the problem — another node should take the work, and this one is
 *   left alone for a while. retryable: it answered with a server error — worth one try elsewhere.
 * fatal: the request itself was refused or the code failed — the same request would fail anywhere.
 */
export type ErrorClass = "unreachable" | "retryable" | "fatal";

export function classifyError(error: unknown): ErrorClass {
  if ((error as { [FATAL]?: true } | null)?.[FATAL]) return "fatal";
  if (error instanceof NodeDownError) return "unreachable";
  if (error instanceof NodeHttpError) {
    if (error.status === 502 || error.status === 503 || error.status === 504) return "unreachable";
    return error.status >= 500 ? "retryable" : "fatal";
  }
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") return "unreachable";
    if (error.name === "TypeError" && /fetch failed/iu.test(error.message)) return "unreachable";
    const code = (error.cause as { code?: string } | undefined)?.code ?? (error as { code?: string }).code;
    if (code && NETWORK_CODES.has(code)) return "unreachable";
  }
  return "fatal";
}
