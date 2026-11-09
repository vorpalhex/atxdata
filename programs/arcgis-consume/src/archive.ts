import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { readFile, unlink, open } from "node:fs/promises";
import { resolve, join, relative, isAbsolute } from "node:path";
import {
  archiveLock,
  statFile,
  promote,
} from "../../civicclerk-consume/src/archive";
import { saveResponse } from "../../legistar-consume/src/ingest/downloader";
import { PoliteHttpClient } from "../../civicclerk-consume/src/http";
import { Store, type Observation } from "./store";
import { ensure, object } from "./check";
import { cooldown } from "./cooldown";
import { validateRunOptions } from "./policy";
export const limits = {
  requests: 25,
  responseBytes: 5_000_000,
  totalBytes: 20_000_000,
  timeoutMs: 45_000,
  retries: 2,
  spacingMs: 2000,
  records: 10,
  zipBytes: 1_000_000,
  expandedBytes: 2_000_000,
  zipMembers: 6,
};
export type Kind = "json" | "text" | "zip" | "redirect" | "file";
export type Dependencies = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  clockDomain?: string;
};
async function digest(path: string) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { sha256: hash.digest("hex"), bytes };
}
function boundedBody(
  body: ReadableStream<Uint8Array>,
  measure: (chunk: Uint8Array) => void,
) {
  const reader = body.getReader();
  let ended = false;
  const cancel = async (reason?: unknown) => {
    if (!ended) {
      ended = true;
      await reader.cancel(reason);
    }
  };
  // One transfer owns the native reader through downstream settlement.
  // EOF closes the wrapper; only the outer owner releases the native lock.
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const item = await reader.read();
        if (item.done) {
          ended = true;
          controller.close();
        } else {
          measure(item.value);
          controller.enqueue(item.value);
        }
      } catch (error) {
        controller.error(error);
      }
    },
    cancel,
  });
  return {
    stream,
    async release() {
      try {
        await cancel();
      } finally {
        reader.releaseLock();
      }
    },
  };
}
function decode(kind: string, raw: Buffer): unknown {
  if (kind === "json") return object(JSON.parse(raw.toString()));
  if (kind === "text") return raw.toString();
  return raw;
}
function retryable(error: unknown) {
  if (error instanceof Error && "status" in error) {
    const n = Number(error.status);
    return [408, 409, 425, 429].includes(n) || (n >= 500 && n <= 599);
  }
  return (
    error instanceof TypeError ||
    (error instanceof DOMException && error.name === "TimeoutError")
  );
}
export class Archive {
  readonly store: Store;
  guard: ((url: string) => void) | undefined;
  private busy = false;
  private spacingMs = limits.spacingMs;
  setSpacing(ms: number) {
    this.store.preflight();
    ensure(Number.isSafeInteger(ms) && ms >= 2000, "invalid spacing");
    this.spacingMs = Math.max(this.spacingMs, ms);
    this.store.recordSpacing(this.spacingMs);
  }
  private constructor(
    readonly root: string,
    private release: () => Promise<void>,
    private deps: Dependencies,
  ) {
    this.store = new Store(join(root, "state.sqlite"), {
      now: deps.now,
      domain: deps.clockDomain ?? "unix-epoch-ms",
      spacingMs: limits.spacingMs,
    });
    this.spacingMs = this.store.minimumSpacing();
  }
  static async open(root: string, dependencies: Partial<Dependencies> = {}) {
    const repo = resolve(import.meta.dir, "../../..");
    ensure(
      isAbsolute(root) &&
        root === resolve(root) &&
        !root.startsWith(repo + "/") &&
        root !== repo,
      "archive must be absolute and outside source",
    );
    const release = await archiveLock(root);
    try {
      for (const suffix of ["", "-wal", "-shm"])
        await statFile(join(root, "state.sqlite" + suffix));
      return new Archive(root, release, {
        fetch: (u, i) => fetch(u, i),
        now: Date.now,
        sleep: Bun.sleep,
        random: Math.random,
        ...dependencies,
        clockDomain:
          dependencies.clockDomain ??
          (dependencies.now ? "injected-epoch-ms" : "unix-epoch-ms"),
      });
    } catch (error) {
      await release();
      throw error;
    }
  }
  async close() {
    this.store.close();
    await this.release();
  }
  private path(path: string) {
    ensure(
      !isAbsolute(path) &&
        relative(this.root, resolve(this.root, path)) === path &&
        !path.includes(".."),
      "unsafe checkpoint path",
    );
    return join(this.root, path);
  }
  private async recovered(row: Observation) {
    this.store.preflight();
    const path = this.path(row.path);
    for (const suffix of ["", ".pending", ".part"])
      await statFile(path + suffix);
    const target = (await statFile(path)) ? path : path + ".pending";
    const hash = await digest(target);
    ensure(
      hash.sha256 === row.sha256 && hash.bytes === row.bytes,
      "checkpoint checksum mismatch",
    );
    if (target !== path) {
      ensure(row.status === "pending", "ready checkpoint file missing");
      await promote(path);
    }
    if (row.status === "pending") this.store.ready(row);
    return readFile(path);
  }
  async read(run: string, label: string) {
    this.policy(run);
    const row = this.store.observation(run, label);
    ensure(row, "missing offline checkpoint");
    const raw = await this.recovered(row);
    return row.kind === "json"
      ? object(JSON.parse(raw.toString()))
      : row.kind === "text"
        ? raw.toString()
        : raw;
  }
  async verify() {
    this.store.preflight();
    for (const row of this.store.db
      .query<{ options: string }, []>("SELECT options FROM acquisition_options")
      .all())
      validateRunOptions(JSON.parse(row.options));
    const integrity = this.store.integrity();
    ensure(
      integrity.integrity === "ok" && integrity.foreignKeys.length === 0,
      "SQLite integrity failed",
    );
    this.store.verifyHistory(); // Reject damaged ready history before recovery can write.
    const rows = this.store.observations();
    for (const row of rows) await this.recovered(row);
    this.store.verifyHistory();
    return { ...integrity, files: rows.length, httpRequests: 0 };
  }
  async readExpected(run: string, label: string, url: string, kind: Kind) {
    const row = this.store.observation(run, label);
    ensure(
      row && row.url === url && row.kind === kind,
      "checkpoint identity mismatch",
    );
    const id = row.path.replace(/\.body$/, "");
    const attempt = this.store.db
      .query<{ run: string; label: string; url: string }, [string]>(
        "SELECT run,label,url FROM attempts WHERE id=?",
      )
      .get(id);
    ensure(
      attempt &&
        attempt.run === run &&
        attempt.label === label &&
        attempt.url === url,
      "checkpoint attempt identity mismatch",
    );
    ensure(
      !this.store.db
        .query(
          "SELECT 1 FROM attempts WHERE run=? AND label=? AND url<>? LIMIT 1",
        )
        .get(run, label, url),
      "checkpoint attempt identity mismatch",
    );
    return this.read(run, label);
  }
  private policy(run: string) {
    return { ...limits, ...this.store.options(run)?.budget };
  }
  private async wait() {
    while (this.store.notBefore() > this.deps.now()) {
      ensure(
        this.store.notBefore() < Number.MAX_SAFE_INTEGER,
        "uninterpretable cooldown: manual review required",
      );
      await this.deps.sleep(
        Math.min(2_147_483_647, this.store.notBefore() - this.deps.now()),
      );
    }
  }
  async request(
    run: string,
    label: string,
    url: string,
    kind: Kind,
    validate: (value: unknown) => unknown | Promise<unknown> = () => {},
  ): Promise<unknown> {
    ensure(!this.busy, "one in-flight request required");
    this.busy = true;
    try {
      const policy = this.policy(run);
      const old = this.store.observation(run, label);
      if (old) {
        ensure(
          old.url === url && old.kind === kind,
          "checkpoint identity mismatch",
        );
        const bytes = await this.recovered(old);
        const value = decode(kind, bytes);
        await validate(value);
        return value;
      }
      this.guard?.(url);
      for (let attempt = 0; ; attempt++) {
        await this.wait();
        const used = this.store.budget(run);
        ensure(
          used.requests < policy.requests && used.bytes < policy.totalBytes,
          "run request/byte ceiling exceeded",
        );
        try {
          return await this.transfer(
            run,
            label,
            url,
            kind,
            policy.totalBytes - used.bytes,
            validate,
          );
        } catch (error) {
          if (attempt >= policy.retries || !retryable(error)) throw error;
          this.store.defer(
            Math.ceil(
              this.deps.now() +
                Math.max(
                  limits.spacingMs,
                  2 ** attempt * 1000 + this.deps.random() * 1000,
                ),
            ),
          );
        }
      }
    } finally {
      this.busy = false;
    }
  }
  private async persist(
    response: Response,
    run: string,
    label: string,
    url: string,
    kind: Kind,
    remaining: number,
    path: string,
    account: (bytes: number) => void,
    validate: (value: unknown) => unknown | Promise<unknown>,
  ) {
    let received = 0;
    ensure(kind !== "redirect", "expected published-file redirect");
    if (kind === "zip")
      ensure(
        [
          "application/zip",
          "application/x-zip-compressed",
          "application/octet-stream",
        ].includes(
          response.headers
            .get("content-type")
            ?.split(";")[0]
            .trim()
            .toLowerCase() ?? "",
        ),
        "unexpected ZIP content type",
      );
    const cap = Math.min(
      remaining,
      kind === "zip" || kind === "file"
        ? this.policy(run).zipBytes
        : this.policy(run).responseBytes,
    );
    const declared = response.headers.get("content-length");
    if (declared !== null)
      ensure(
        /^\d+$/.test(declared) && Number(declared) <= cap,
        "response byte ceiling exceeded",
      );
    ensure(response.body, "response body missing");
    // Lock the native body before the first filesystem await; on Bun 1.3.14
    // acquiring a reader after native EOF can leave broken release bookkeeping.
    const metered = boundedBody(response.body, (chunk) => {
      received += chunk.byteLength;
      account(chunk.byteLength);
      ensure(received <= cap, "response byte ceiling exceeded");
    });
    const written = await (async () => {
      try {
        for (const suffix of ["", ".pending", ".part"])
          ensure(
            !(await statFile(path + suffix)),
            "no-clobber output conflict",
          );
        return await saveResponse(
          new Response(metered.stream),
          path + ".pending",
          path + ".part",
        );
      } finally {
        await metered.release();
      }
    })();
    const handle = await open(path + ".pending", "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    const raw = await readFile(path + ".pending");
    const value = decode(kind, raw);
    await validate(value);
    const row: Observation = {
      run,
      label,
      url,
      sha256: written.sha256,
      bytes: written.byteSize,
      path: relative(this.root, path),
      kind,
      status: "pending",
      retrieved: new Date(this.deps.now()).toISOString(),
    };
    this.store.checkpoint(row);
    await promote(path);
    this.store.ready(row);
    return value;
  }
  private async recordHeaders(
    id: string,
    response: Response,
    headers: Record<string, string>,
  ) {
    try {
      this.store.headers(
        id,
        response.status,
        headers,
        cooldown(response.headers, this.deps.now()),
      );
    } catch (error) {
      this.store.headers(id, response.status, headers, Number.MAX_SAFE_INTEGER);
      await response.body?.cancel();
      throw error;
    }
  }
  private async transfer(
    run: string,
    label: string,
    url: string,
    kind: Kind,
    remaining: number,
    validate: (value: unknown) => unknown | Promise<unknown>,
  ) {
    const allowance = Math.min(
      remaining,
      kind === "zip" || kind === "file"
        ? this.policy(run).zipBytes
        : this.policy(run).responseBytes,
    );
    const id = this.store.attempt(run, label, url, allowance),
      path = join(this.root, id + ".body");
    let status: number | null = null,
      headers: Record<string, string> = {},
      bytes = 0,
      failure: string | undefined;
    const http = new PoliteHttpClient(
      {
        timeoutMs: limits.timeoutMs,
        minIntervalMs: this.spacingMs,
        maxRetries: 0,
        userAgent: "atxdata-arcgis/0.1",
      },
      {
        ...this.deps,
        fetch: async (u, init) => {
          this.store.dispatch(id, this.spacingMs);
          const response = await this.deps.fetch(u, init);
          status = response.status;
          headers = Object.fromEntries(response.headers);
          await this.recordHeaders(id, response, headers);
          return response;
        },
      },
    );
    try {
      return await http.request(url, (response) =>
        this.persist(
          response,
          run,
          label,
          url,
          kind,
          remaining,
          path,
          (n) => {
            bytes += n;
          },
          validate,
        ),
      );
    } catch (error) {
      if ((kind === "redirect" || kind === "file") && status === 302) {
        ensure(
          typeof headers.location === "string",
          "missing redirect Location",
        );
        return { location: headers.location };
      }
      failure = error instanceof Error ? error.message : "transfer failed";
      throw error;
    } finally {
      this.store.finishAttempt(
        id,
        status,
        headers,
        bytes,
        this.deps.now() + this.spacingMs,
        failure,
      );
    }
  }
}
