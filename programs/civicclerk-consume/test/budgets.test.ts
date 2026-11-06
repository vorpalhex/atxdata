import { expect, test } from "bun:test";
import { CivicClerkClient, type DownloadOptions } from "../src/client";
import { mkdtemp, realpath, readdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
const body = "%PDF-1.7\nfixture";
const file = { fileId: 1, fileType: 1, type: "Agenda", name: "Final" };
const event = { id: 59, eventName: "Court", eventDate: "2021-01-05T09:00:00Z", publishedFiles: [file] };
const invalid = [NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1];
async function directory() { return mkdtemp(join(await realpath(tmpdir()), "civic-budgets-")); }
function fixture(files = [file], payload: BodyInit = body, discovery = () => {}) {
  const calls: string[] = [];
  return { calls, api: new CivicClerkClient({
    async getJson<T>(url: string): Promise<T> { calls.push(url); discovery(); return { ...event, publishedFiles: files } as T; },
    async request<T>(url: string, consume: (response: Response) => Promise<T>): Promise<T> {
      calls.push(url); return consume(new Response(payload, { headers: { "content-type": "application/pdf" } }));
    },
  }, "https://example.test/v1/") };
}
async function files(root: string) {
  const names = (await readdir(root, { recursive: true })).sort();
  return Promise.all(names.map(async name => {
    const path = join(root, name);
    if (name === "event-59") return [name];
    return [name, createHash("sha256").update(await readFile(path)).digest("hex")];
  }));
}
test("invalid numeric budgets reject before any discovery or archive write", async () => {
  const root = await directory();
  try {
    const f = fixture();
    for (const key of ["maxBytes", "maxDocuments"] as const) for (const value of invalid) {
      await expect(f.api.downloadEvent(59, join(root, "absent"), { [key]: value })).rejects.toThrow("budget");
      expect(f.calls).toEqual([]); expect(await readdir(root)).toEqual([]);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("invalid budgets also reject cached and offline paths without changing any bytes", async () => {
  const root = await directory();
  try {
    const f = fixture(); await f.api.downloadEvent(59, root); const before = await files(root), calls = f.calls.length;
    for (const offline of [false, true]) for (const key of ["maxBytes", "maxDocuments"] as const) for (const value of invalid) {
      await expect(f.api.downloadEvent(59, root, { offline, [key]: value })).rejects.toThrow("budget");
      expect(f.calls).toHaveLength(calls); expect(await files(root)).toEqual(before);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("budgets are snapshotted once before asynchronous discovery", async () => {
  const root = await directory(), options: DownloadOptions = { maxBytes: 0, maxDocuments: 1 };
  try {
    const f = fixture([file], body, () => { options.maxBytes = NaN; options.maxDocuments = Infinity; });
    await expect(f.api.downloadEvent(59, root, options)).rejects.toThrow("ceiling");
    expect(f.calls).toHaveLength(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("zero permits empty selections but refuses documents before any PDF request", async () => {
  for (const key of ["maxBytes", "maxDocuments"] as const) {
    const root = await directory();
    try {
      expect(await fixture([]).api.downloadEvent(59, root, { [key]: 0 })).toEqual({ downloaded: 0, skipped: 0 });
      const f = fixture(); await expect(f.api.downloadEvent(59, root, { [key]: 0 })).rejects.toThrow("ceiling");
      expect(f.calls).toHaveLength(1);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});
test("exact and safe-integer ceilings work on fresh and cached files", async () => {
  const root = await directory();
  try {
    const f = fixture();
    expect(await f.api.downloadEvent(59, root, { maxBytes: body.length, maxDocuments: 1 })).toEqual({ downloaded: 1, skipped: 0 });
    expect(await f.api.downloadEvent(59, root, { offline: true, maxBytes: body.length, maxDocuments: 1 })).toEqual({ downloaded: 0, skipped: 1 });
    expect(await f.api.downloadEvent(59, root, { offline: true, maxBytes: Number.MAX_SAFE_INTEGER, maxDocuments: Number.MAX_SAFE_INTEGER })).toEqual({ downloaded: 0, skipped: 1 });
    const path = join(root, "event-59/type-1_file-1_final.pdf"); await rename(path, `${path}.pending`);
    await expect(f.api.downloadEvent(59, root, { offline: true, maxBytes: body.length - 1 })).rejects.toThrow("ceiling");
    expect(await readdir(join(root, "event-59"))).toEqual(["type-1_file-1_final.pdf.pending"]); expect(f.calls).toHaveLength(2);
    expect(await f.api.downloadEvent(59, root, { offline: true, maxBytes: body.length })).toEqual({ downloaded: 0, skipped: 1 });
    expect(f.calls).toHaveLength(2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("omitted document budget is finite and accepts exactly one hundred selected documents", async () => {
  const root = await directory();
  try {
    const f = fixture(Array(100).fill(file));
    expect(await f.api.downloadEvent(59, root)).toEqual({ downloaded: 1, skipped: 99 });
    const over = fixture(Array(101).fill(file)); await expect(over.api.downloadEvent(59, root)).rejects.toThrow("ceiling"); expect(over.calls).toHaveLength(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("remaining combined byte budget refuses the next transfer and cached promotion", async () => {
  const root = await directory(), selected = [file, { ...file, fileId: 2 }];
  try {
    const f = fixture(selected);
    await expect(f.api.downloadEvent(59, root, { maxBytes: body.length, maxDocuments: 2 })).rejects.toThrow("ceiling");
    expect(f.calls).toHaveLength(2); expect(await readdir(join(root, "event-59"))).toEqual(["type-1_file-1_final.pdf"]);
    expect(await f.api.downloadEvent(59, root, { maxBytes: body.length * 2 })).toEqual({ downloaded: 1, skipped: 1 });
    const path = join(root, "event-59/type-1_file-2_final.pdf"); await rename(path, `${path}.pending`);
    const calls = f.calls.length;
    await expect(f.api.downloadEvent(59, root, { offline: true, maxBytes: body.length * 2 - 1 })).rejects.toThrow("ceiling");
    expect(f.calls).toHaveLength(calls); expect((await readdir(join(root, "event-59"))).sort()).toEqual(["type-1_file-1_final.pdf", "type-1_file-2_final.pdf.pending"]);
    expect(await f.api.downloadEvent(59, root, { offline: true, maxBytes: body.length * 2 })).toEqual({ downloaded: 0, skipped: 2 });
    expect(f.calls).toHaveLength(calls);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("omitted byte budget is exactly twelve MiB, not unbounded", async () => {
  for (const extra of [0, 1]) {
    const root = await directory(), payload = new Uint8Array(12 * 1024 * 1024 + extra); payload.set(new TextEncoder().encode("%PDF-"));
    try {
      const pending = fixture([file], payload).api.downloadEvent(59, root);
      if (extra === 0) expect(await pending).toEqual({ downloaded: 1, skipped: 0 });
      else await expect(pending).rejects.toThrow("ceiling");
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});
