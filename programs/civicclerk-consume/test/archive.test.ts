import { expect, test } from "bun:test";
import { CivicClerkClient } from "../src/client";
import { PoliteHttpClient } from "../src/http";
import { Database } from "bun:sqlite";
import { realpath, mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const event = { id: 59, eventName: "Court", eventDate: "2021-01-05T09:00:00Z", publishedFiles: [{ fileId: 157, fileType: 1, type: "Agenda", name: "Final" }] };
const base = "https://example.test/v1/";
function fixture(body = "%PDF-1.7\nfixture") {
  let calls = 0;
  const api = new CivicClerkClient(new PoliteHttpClient({ minIntervalMs: 0 }, { fetch: async url => {
    calls++; return url.includes("Events/") ? Response.json(event) : new Response(body, { headers: { "content-type": "application/pdf" } });
  } }), base);
  return { api, calls: () => calls };
}
test("rejects unsafe roots and ancestor symlinks before HTTP", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "civic-root-")); const f = fixture();
  try {
    await mkdir(join(root, "inside"));
    await symlink(join(root, "inside"), join(root, "alias"));
    for (const path of ["relative", "/", `${root}/alias/../escape`, join(root, "alias", "archive")]) await expect(f.api.downloadEvent(59, path)).rejects.toThrow();
    expect(f.calls()).toBe(0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("owns one archive lock before discovery and does not remove another owner's lock", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "civic-lock-")); const f = fixture();
  try {
    await writeFile(join(root, ".civicclerk.lock"), "other-owner");
    await expect(f.api.downloadEvent(59, root)).rejects.toThrow();
    expect(f.calls()).toBe(0); expect(await readFile(join(root, ".civicclerk.lock"), "utf8")).toBe("other-owner");
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("rejects mislabeled content and byte ceiling with failed SQLite status", async () => {
  for (const [body, maxBytes] of [["<html>challenge</html>", 100], ["%PDF-1.7\nlarge", 8]] as const) {
    const root = await mkdtemp(join(await realpath(tmpdir()), "civic-invalid-"));
    try {
      await expect(fixture(body).api.downloadEvent(59, root, { maxBytes })).rejects.toThrow();
      expect(await readdir(join(root, "event-59"))).toEqual([]);
      const db = new Database(join(root, "civicclerk.sqlite"));
      expect(db.query("SELECT status FROM ingest_runs").get()).toEqual({ status: "failed" }); db.close();
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});
test("offline rerun and interrupted promotion recover with no HTTP or duplicate PDFs", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "civic-offline-")); const f = fixture();
  try {
    expect(await f.api.downloadEvent(59, root)).toEqual({ downloaded: 1, skipped: 0 });
    const folder = join(root, "event-59"), path = join(folder, "type-1_file-157_final.pdf");
    await writeFile(`${path}.pending`, await readFile(path)); await rm(path);
    expect(await f.api.downloadEvent(59, root, { offline: true })).toEqual({ downloaded: 0, skipped: 1 });
    expect(f.calls()).toBe(2); expect(await readdir(folder)).toEqual(["type-1_file-157_final.pdf"]);
    expect(await f.api.downloadEvent(59, root, { offline: true })).toEqual({ downloaded: 0, skipped: 1 }); expect(f.calls()).toBe(2);
    await writeFile(path, "corrupt");
    await expect(f.api.downloadEvent(59, root)).rejects.toThrow("checkpoint");
    expect(f.calls()).toBe(3); expect(await readFile(path, "utf8")).toBe("corrupt");
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("uncheckpointed files and pending/SQLite symlinks never get overwritten", async () => {
  for (const name of ["event-59/type-1_file-157_final.pdf", "event-59/type-1_file-157_final.pdf.pending", "civicclerk.sqlite"]) {
    const root = await mkdtemp(join(await realpath(tmpdir()), "civic-clobber-")); const f = fixture();
    try {
      await mkdir(join(root, "event-59")); await writeFile(join(root, "outside"), "untouched");
      await symlink(join(root, "outside"), join(root, name));
      await expect(f.api.downloadEvent(59, root)).rejects.toThrow();
      expect(await readFile(join(root, "outside"), "utf8")).toBe("untouched"); expect(f.calls()).toBeLessThanOrEqual(1);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("a process interrupted after SQLite checkpoint recovers offline after owned stale-lock removal", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "civic-crash-"));
  const source = new URL("../src/client.ts", import.meta.url).pathname;
  const database = new URL("../src/storage/db.ts", import.meta.url).pathname;
  try {
    const script = join(root, "crash.ts");
    await writeFile(script, `import {CivicClerkClient} from ${JSON.stringify(source)};
import {CivicDatabase} from ${JSON.stringify(database)};
const original=CivicDatabase.prototype.downloaded;
CivicDatabase.prototype.downloaded=function(...args) { original.apply(this,args); process.exit(70); };
const api=new CivicClerkClient({getJson:async()=>(${JSON.stringify(event)}),request:async(url,consume)=>consume(new Response("%PDF-crash",{headers:{"content-type":"application/pdf"}}))},${JSON.stringify(base)});
await api.downloadEvent(59,${JSON.stringify(root)});`);
    const child = Bun.spawn([process.execPath, script], { stdout: "pipe", stderr: "pipe" });
    expect(await child.exited).toBe(70);
    const lock = JSON.parse(await readFile(join(root, ".civicclerk.lock"), "utf8"));
    expect(lock.pid).toBe(child.pid); // Process exited; only this test-owned stale lock is removed.
    await rm(join(root, ".civicclerk.lock"));
    const f = fixture();
    expect(await f.api.downloadEvent(59, root, { offline: true })).toEqual({ downloaded: 0, skipped: 1 });
    expect(f.calls()).toBe(0);
    expect(await readdir(join(root, "event-59"))).toEqual(["type-1_file-157_final.pdf"]);
    const db = new Database(join(root, "civicclerk.sqlite"));
    expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    expect(db.query("SELECT status FROM ingest_runs ORDER BY rowid").all()).toEqual([{ status: "running" }, { status: "succeeded" }]); db.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("exact document/byte ceilings and expected date are enforced including zero budgets", async () => {
  for (const options of [
    { maxBytes: 16, maxDocuments: 1, expectedDate: "2021-01-05" },
    { maxBytes: 0 }, { maxDocuments: 0 }, { expectedDate: "2021-01-06" },
  ]) {
    const root = await mkdtemp(join(await realpath(tmpdir()), "civic-bounds-"));
    try {
      const f = fixture();
      if (options.maxBytes === 16) expect(await f.api.downloadEvent(59, root, options)).toEqual({ downloaded: 1, skipped: 0 });
      else await expect(f.api.downloadEvent(59, root, options)).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});
test("uncheckpointed regular partials are retained without a PDF request", async () => {
  for (const suffix of [".part", ".pending"]) {
    const root = await mkdtemp(join(await realpath(tmpdir()), "civic-partial-")); const f = fixture();
    try {
      await mkdir(join(root, "event-59")); const path = join(root, "event-59", `type-1_file-157_final.pdf${suffix}`);
      await writeFile(path, "%PDF-partial");
      await expect(f.api.downloadEvent(59, root)).rejects.toThrow("uncheckpointed");
      expect(f.calls()).toBe(1); expect(await readFile(path, "utf8")).toBe("%PDF-partial");
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});
