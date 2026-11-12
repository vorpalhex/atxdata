import { test, expect } from "bun:test";
import { createServer } from "node:net";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { Archive } from "../src/archive";
for (const mode of ["short-body", "unterminated-chunk", "preheader-reset"])
  test(
    "raw native incomplete transfer always holds " + mode,
    async () => {
      let calls = 0;
      const server = createServer((socket) => {
        socket.once("data", () => {
          calls++;
          if (mode === "preheader-reset") {
            socket.destroy();
            return;
          }
          socket.write(
            mode === "short-body"
              ? "HTTP/1.1 302 Found\r\nContent-Length: 30\r\nLocation: https://geohub.austintexas.gov/\r\nConnection: close\r\n\r\nabc"
              : "HTTP/1.1 403 Forbidden\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n3\r\nabc\r\n",
          );
          setTimeout(() => socket.destroy(), 20);
        });
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/robots.txt`;
      const a = await Archive.open(
        await mkdtemp(join(process.env.TMPDIR!, "raw-native-fault-")),
        {
          fetch: (u, i) =>
            fetch(u, {
              ...i,
              signal: AbortSignal.any([i.signal!, AbortSignal.timeout(250)]),
            }),
        },
      );
      a.store.source("fixture", "fixture", "https://example.invalid");
      const run = a.store.start("fixture", "inspect-policy");
      a.store.saveOptions(run, {
        mode: "wrapper-policy-v1",
        policyReceiptVersion: 1,
        budget: { retries: 0 },
      });
      try {
        await expect(
          a.request(run, "policy-hop-0", url, "policy-raw-v1"),
        ).rejects.toThrow();
        expect(calls).toBe(1);
        expect(a.store.observations().length).toBe(0);
        expect(a.store.notBefore()).toBe(Number.MAX_SAFE_INTEGER);
      } finally {
        await a.close();
        await new Promise<void>((r) => server.close(() => r()));
      }
    },
    5000,
  );
