import type { AppConfig } from "../config";
import type { Logger } from "./logger";

export type HttpClient = {
  getJson: <T>(url: string) => Promise<T>;
  fetchWithRetry: (url: string, init?: RequestInit) => Promise<Response>;
};

type Dependencies = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  random: () => number;
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestHeaders(userAgent: string, input?: HeadersInit): Headers {
  const headers = new Headers({ Accept: "*/*", "User-Agent": userAgent });
  new Headers(input).forEach((value, name) => headers.set(name, value));
  return headers;
}

function retryAfterMs(response: Response, now: number): number | null {
  const raw = response.headers.get("retry-after");
  if (!raw?.trim()) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return null;
}

function shouldRetry(status: number): boolean {
  return [408, 409, 425, 429].includes(status) || status >= 500;
}

// The timeout belongs to the whole response, not just receipt of headers.
function timedResponse(response: Response, signal: AbortSignal, clear: () => void): Response {
  if (!response.body) {
    clear();
    return response;
  }
  const reader = response.body.getReader();
  let abort: () => void;
  function cleanup() {
    clear();
    signal.removeEventListener("abort", abort);
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      abort = () => {
        cleanup();
        controller.error(signal.reason);
        void reader.cancel(signal.reason).catch(() => {});
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          cleanup();
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        cleanup();
        controller.error(error);
      }
    },
    cancel(reason) {
      cleanup();
      return reader.cancel(reason);
    },
  });
  const result = new Response(body, response);
  // Response's constructor does not preserve fetch metadata.
  for (const key of ["url", "redirected", "type"] as const) {
    Object.defineProperty(result, key, { value: response[key] });
  }
  return result;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function request(
  url: string, init: RequestInit, config: AppConfig, deps: Dependencies,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), config.httpTimeoutMs);
  const clear = () => clearTimeout(timeout);
  const signals = [controller.signal];
  if (init.signal) signals.push(init.signal);
  const signal = AbortSignal.any(signals);
  try {
    signal.throwIfAborted();
    const response = await deps.fetch(url, {
      ...init,
      redirect: init.redirect ?? "follow",
      signal,
      headers: requestHeaders(config.userAgent, init.headers),
    });
    return timedResponse(response, signal, clear);
  } catch (error) {
    clear();
    throw error;
  }
}

async function loggedRequest(
  url: string, init: RequestInit, attempt: number, config: AppConfig, logger: Logger, deps: Dependencies,
): Promise<Response | Error> {
  const started = deps.now();
  try {
    const response = await request(url, init, config, deps);
    logger.info("http.request", { url, status: response.status, elapsedMs: Math.round(deps.now() - started), attempt });
    return response;
  } catch (error) {
    const failure = asError(error);
    logger.warn("http.error", { url, attempt, elapsedMs: Math.round(deps.now() - started), error: failure.message });
    return failure;
  }
}

function finalResult(result: Response | Error): Response {
  if (result instanceof Error) throw result;
  return result;
}

function backoff(attempt: number, random: number): number {
  return Math.min(30_000, 500 * 2 ** attempt + random * 250);
}

async function waitForRetry(result: Response | Error, url: string, attempt: number, logger: Logger, deps: Dependencies): Promise<void> {
  let delay = backoff(attempt, deps.random());
  if (result instanceof Response) {
    delay = retryAfterMs(result, deps.now()) ?? delay;
    logger.warn("http.retry", { url, status: result.status, attempt, delayMs: Math.round(delay) });
    // The response is discarded; a broken cancellation must not replace its retry policy.
    await result.body?.cancel().catch(() => {});
  }
  await deps.sleep(delay);
}

export function createHttpClient(config: AppConfig, logger: Logger, dependencies: Partial<Dependencies> = {}): HttpClient {
  const deps: Dependencies = { fetch: (url, init) => fetch(url, init), sleep, now: Date.now, random: Math.random, ...dependencies };

  async function fetchWithRetry(url: string, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      init.signal?.throwIfAborted();
      const result = await loggedRequest(url, init, attempt, config, logger, deps);
      init.signal?.throwIfAborted();
      if (attempt === config.maxDownloadRetries) return finalResult(result);
      if (result instanceof Response && !shouldRetry(result.status)) return result;
      await waitForRetry(result, url, attempt, logger, deps);
    }
  }

  async function getJson<T>(url: string): Promise<T> {
    const response = await fetchWithRetry(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GET ${url} failed with ${response.status}: ${body.slice(0, 500)}`);
    }
    return (await response.json()) as T;
  }

  return { getJson, fetchWithRetry };
}
