// Subprocess fixture: synthetic by default; private original bytes may be supplied.
import { Archive } from "../src/archive";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
const root = process.argv[2]!;
const raw = process.env.ARCGIS_REPLAY_BODY
  ? await readFile(process.env.ARCGIS_REPLAY_BODY)
  : Buffer.from(JSON.stringify({ value: "x".repeat(37537) }));
const sha256 = createHash("sha256").update(raw).digest("hex");
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => new Response(raw),
});
let now = 0;
const a = await Archive.open(root, {
  now: () => now,
  sleep: async (ms) => {
    now += ms;
  },
});
a.store.source("fixture", "local replay", server.url.href);
try {
  for (let i = 0; i < 20; i++) {
    const run = a.store.start("fixture", "diagnostic");
    try {
      await a.request(run, "site-data", server.url.href, "json");
      const row = a.store.observation(run, "site-data")!;
      if (row.bytes !== raw.length || row.sha256 !== sha256)
        throw new Error("replay identity mismatch");
      a.store.finish(run, "succeeded");
    } catch (error) {
      a.store.finish(run, "failed", String(error));
      throw error;
    }
    Bun.gc(true);
  }
  const status = a.store.status();
  if (
    status.attempts !== 20 ||
    status.failed !== 0 ||
    status.running !== 0 ||
    status.observations !== 20
  )
    throw new Error("replay status/retry mismatch: " + JSON.stringify(status));
  console.log(
    JSON.stringify({
      status,
      sha256,
      bytes: raw.length,
      verified: await a.verify(),
    }),
  );
} finally {
  await a.close();
  server.stop(true);
}
await Bun.sleep(100); // Detached native errors must affect the subprocess exit.
