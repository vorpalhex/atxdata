type Dependencies = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  random: () => number;
};
export type HttpOptions = { maxRetries?: number; timeoutMs?: number; minIntervalMs?: number; userAgent?: string };
class HttpError extends Error {
  constructor(readonly status: number) { super(`HTTP ${status}`); }
}
function transient(error: unknown): boolean {
  if (error instanceof HttpError) return [408, 409, 425, 429].includes(error.status) || (error.status >= 500 && error.status <= 599);
  if (error instanceof DOMException) return error.name === "TimeoutError";
  if (error instanceof Error && "code" in error) return ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "EAI_AGAIN", "ConnectionClosed", "ConnectionRefused"].includes(String(error.code));
  return error instanceof TypeError;
}

function retryAfter(response: Response, now: number): number {
  const raw = response.headers.get("Retry-After");
  if (!raw?.trim()) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const serverDate = Date.parse(response.headers.get("Date") ?? "");
  return Math.max(0, Date.parse(raw) - (Number.isFinite(serverDate) ? serverDate : now)) || 0;
}

function resetDelay(response: Response, prefix: string, now: number): number {
  if (response.headers.get(`${prefix}RateLimit-Remaining`)?.trim() !== "0") return 0;
  const reset = Number(response.headers.get(`${prefix}RateLimit-Reset`));
  return Number.isFinite(reset) ? Math.max(0, reset * 1000 - (prefix ? now : 0)) : 0;
}
function structuredDelay(header: string): number {
  return Math.max(0, ...header.split(",").map(policy => {
    policy = policy.trim();
    if (!/(?:^|;)\s*r\s*=\s*0(?:;|$)/.test(policy)) return 0;
    const seconds = Number(/(?:^|;)\s*t\s*=\s*(\d+(?:\.\d+)?)(?:;|$)/.exec(policy)?.[1]);
    return Number.isFinite(seconds) ? seconds * 1000 : 0;
  }));
}
function serverDelay(response: Response, now: number): number {
  return Math.max(retryAfter(response, now), resetDelay(response, "", now), resetDelay(response, "X-", now), structuredDelay(response.headers.get("RateLimit") ?? ""));
}

/** One queue owns complete transfers, not merely receipt of response headers. */
export class PoliteHttpClient {
  private queue = Promise.resolve();
  private notBefore = 0;
  private readonly deps: Dependencies;
  constructor(private readonly options: HttpOptions = {}, dependencies: Partial<Dependencies> = {}) {
    for (const [key, minimum] of [["maxRetries", 0], ["timeoutMs", 1], ["minIntervalMs", 0]] as const) {
      const value = options[key];
      if (value !== undefined && (!Number.isSafeInteger(value) || value < minimum || value > 2_147_483_647)) throw new Error(`Invalid ${key}`);
    }
    this.deps = { fetch: (url, init) => fetch(url, init), sleep: Bun.sleep, now: Date.now, random: Math.random, ...dependencies };
  }
  private async transfer<T>(url: string, consume: (response: Response) => Promise<T>): Promise<T> {
    while (this.notBefore > this.deps.now()) await this.deps.sleep(Math.min(2_147_483_647, this.notBefore - this.deps.now()));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), this.options.timeoutMs ?? 180_000);
    let response: Response | undefined;
    try {
      response = await this.deps.fetch(url, { signal: controller.signal, headers: { Accept: "*/*", "User-Agent": this.options.userAgent ?? "atxdata-civicclerk/0.1" } });
      this.notBefore = Math.max(this.notBefore, this.deps.now() + serverDelay(response, this.deps.now()));
      if (!response.ok) throw new HttpError(response.status);
      return await consume(response);
    } finally {
      clearTimeout(timeout);
      await response?.body?.cancel().catch(() => {});
      this.notBefore = Math.max(this.notBefore, this.deps.now() + (this.options.minIntervalMs ?? 1000));
    }
  }
  private async retry<T>(url: string, consume: (response: Response) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.transfer(url, consume); }
      catch (error) {
        if (attempt >= (this.options.maxRetries ?? 3) || !transient(error)) throw error;
        this.notBefore = Math.max(this.notBefore, this.deps.now() + Math.min(30_000, 500 * 2 ** attempt + this.deps.random() * 250));
      }
    }
  }
  request<T>(url: string, consume: (response: Response) => Promise<T>): Promise<T> {
    const task = this.queue.then(() => this.retry(url, consume));
    this.queue = task.then(() => {}, () => {});
    return task;
  }
  getJson<T>(url: string): Promise<T> { return this.request(url, response => response.json()); }
}
