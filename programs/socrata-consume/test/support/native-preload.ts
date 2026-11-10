import { mock } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
const modulePath = new URL("../../src/transport.ts", import.meta.url).pathname;
const original = { ...(await import(modulePath)) },
  Base = original.Session,
  nativeFetch = globalThis.fetch;
const endpoint = process.env.SOCRATA_FIXTURE_ORIGIN;
if (!endpoint || new URL(endpoint).hostname !== "127.0.0.1")
  throw Error("loopback-only fixture endpoint required");
const fixtureURL = new URL(endpoint);
class FixtureSession extends Base {
  static async open(
    root: string,
    deps: Record<string, unknown> = {},
    timeoutMs?: number,
  ) {
    let time = 1800000000000;
    const path = join(root, "transport", "state.sqlite");
    if (existsSync(path)) {
      const db = new Database(path, { readonly: true });
      try {
        time = Math.max(
          time,
          db
            .query<{ n: number }, []>(
              "SELECT max(clock_ms) AS n FROM timing_events",
            )
            .get()!.n ?? 0,
        );
      } finally {
        db.close();
      }
    }
    return Base.open(
      root,
      {
        ...deps,
        clockDomain: "fixture-epoch-ms",
        now: () => time,
        sleep: async (ms: number) => {
          time += ms;
        },
        fetch: (url: string, init: RequestInit) => {
          original.admitted(url);
          const headers = new Headers(init.headers);
          headers.set("x-fixture-source", url);
          return nativeFetch(fixtureURL, { ...init, headers });
        },
      },
      timeoutMs,
    );
  }
}
mock.module(modulePath, () => ({ ...original, Session: FixtureSession }));
