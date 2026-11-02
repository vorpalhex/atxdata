import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
function snapshot(root: string) {
  const db = new Database(join(root, "civicclerk.sqlite"), { readonly: true });
  try {
    return { event: db.query<{ id: number }, []>("SELECT event_id AS id FROM meetings").get(),
      files: db.query<{ filename: string; sha256: string; byteSize: number }, []>("SELECT filename,sha256,byte_size AS byteSize FROM documents WHERE download_status='downloaded'").all() };
  } finally { db.close(); }
}
import { calendarDate, CivicClerkClient } from "../src/client";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, readdir, symlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("rejects symlink escape paths and non-PDF responses; records empty events", async () => {
  const root = await mkdtemp(join(tmpdir(), "civic-safety-"));
  const file = { fileId: 1, fileType: 1, type: "Agenda", name: "Agenda" };
  const make = (files = [file], response = new Response("error", { headers: { "content-type": "text/html" } })) => new CivicClerkClient({
    async getJson<T>(): Promise<T> { return { ...event, publishedFiles: files } as T; },
    async request<T>(_url: string, consume: (response: Response) => Promise<T>): Promise<T> { return consume(response); },
  }, base);
  try {
    await mkdir(join(root, "outside"));
    await symlink(join(root, "outside"), join(root, "event-59"));
    await expect(make().downloadEvent(59, root)).rejects.toThrow("symlink");
    expect(await readdir(join(root, "outside"))).toEqual([]);
    await rm(join(root, "event-59"));
    await expect(make().downloadEvent(59, root)).rejects.toThrow("PDF");
    expect(await readdir(join(root, "event-59"))).toEqual([]);
    await make([]).downloadEvent(59, root);
    expect(snapshot(root).files).toEqual([]);
    expect(snapshot(root).event?.id).toBe(59);
    for (const name of ["type-1_file-1_agenda.pdf", "type-1_file-1_agenda.pdf.part"]) {
      const path = join(root, "event-59", name);
      await rm(path, { force: true });
      await symlink(join(root, "outside", "target"), path);
      await expect(make().downloadEvent(59, root)).rejects.toThrow("symlink");
      await rm(path);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("resumes after a broken stream without keeping partial documents", async () => {
  const root = await mkdtemp(join(tmpdir(), "civic-resume-"));
  let fail = true;
  const urls: string[] = [];
  const api = new CivicClerkClient({
    async getJson<T>(): Promise<T> { return { ...event, publishedFiles: [1, 2].map(fileId => ({ fileId, fileType: 1, type: "Agenda", name: "Final" })) } as T; },
    async request<T>(url: string, consume: (response: Response) => Promise<T>): Promise<T> {
      urls.push(url);
      const stream = new ReadableStream<Uint8Array>({ pull(controller) {
        if (fail && url.includes("fileId=2,")) controller.error(new TypeError("broken stream"));
        else { controller.enqueue(new TextEncoder().encode("%PDF-fixture")); controller.close(); }
      } });
      return consume(new Response(stream, { headers: { "content-type": "application/pdf" } }));
    },
  }, base);
  try {
    await expect(api.downloadEvent(59, root)).rejects.toThrow("broken stream");
    expect((await readdir(join(root, "event-59"))).sort()).toEqual(["type-1_file-1_final.pdf"]);
    fail = false;
    expect(await api.downloadEvent(59, root)).toEqual({ downloaded: 1, skipped: 1 });
    expect(urls).toHaveLength(3);
    const db = new Database(join(root, "civicclerk.sqlite"), { readonly: true });
    try {
      expect(db.query("SELECT status FROM ingest_runs ORDER BY rowid").all()).toEqual([{ status: "failed" }, { status: "succeeded" }]);
      expect(db.query("SELECT count(*) AS n FROM documents WHERE download_status='downloaded' AND error IS NULL").get()).toEqual({ n: 2 });
    } finally { db.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("streams documents serially and repairs missing or corrupt files using checksums", async () => {
  const root = await mkdtemp(join(tmpdir(), "civic-client-"));
  const body = "%PDF-1.7\nfixture";
  let active = false;
  let calls = 0;
  const files = [1, 2, 4, 5].map(fileType => ({ fileId: 157, fileType, type: `Type ${fileType}`, name: "../../unsafe/file" }));
  const api = new CivicClerkClient({
    async getJson<T>(): Promise<T> { return { ...event, publishedFiles: [...files, { fileId: 99, fileType: 9, type: "Video", name: "Video" }] } as T; },
    async request<T>(url: string, consume: (response: Response) => Promise<T>): Promise<T> {
      expect(active).toBe(false);
      expect(url).toBe(`${base}Meetings/GetMeetingFileStream(fileId=157,plainText=false)`);
      active = true; calls++;
      try { return await consume(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(body)); controller.close(); } }), { headers: { "content-type": "application/pdf" } })); }
      finally { active = false; }
    },
  }, base);
  try {
    const first = await api.downloadEvent(59, root);
    expect(first.downloaded).toBe(4);
    const folder = join(root, "event-59");
    const manifest = snapshot(root);
    expect(manifest.event?.id).toBe(59);
    expect(manifest.files).toHaveLength(4);
    for (const file of manifest.files) {
      expect(file.filename).not.toContain("/");
      expect(file.sha256).toBe(createHash("sha256").update(body).digest("hex"));
      expect(file.byteSize).toBe(Buffer.byteLength(body));
      expect(await readFile(join(folder, file.filename), "utf8")).toBe(body);
    }
    expect((await api.downloadEvent(59, root)).skipped).toBe(4);
    expect(calls).toBe(4);
    await writeFile(join(folder, manifest.files[0].filename), "corrupt");
    await rm(join(folder, manifest.files[1].filename));
    expect(await api.downloadEvent(59, root)).toMatchObject({ downloaded: 2, skipped: 2 });
    expect(calls).toBe(6);
    expect((await readdir(folder)).filter(name => name.endsWith(".part"))).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

const base = "https://example.test/v1/";
const event = { id: 59, eventName: "Court", eventDate: "2021-01-05T09:00:00Z", publishedFiles: [] };
function client(pages: unknown[]) {
  const urls: string[] = [];
  return { urls, api: new CivicClerkClient({
    async getJson<T>(url: string): Promise<T> { urls.push(url); return pages.shift() as T; },
    async request<T>(): Promise<T> { throw new Error("unexpected download"); },
  }, base) };
}

test("rejects a second tenant before it can overwrite archived PDFs", async () => {
  const root = await mkdtemp(join(tmpdir(), "civic-tenant-"));
  const make = (tenant: string) => new CivicClerkClient({
    async getJson<T>(): Promise<T> { return { ...event, publishedFiles: [{ fileId: 1, fileType: 1, type: "Agenda", name: "Final" }] } as T; },
    async request<T>(_url: string, consume: (response: Response) => Promise<T>): Promise<T> { return consume(new Response(`%PDF-${tenant}`, { headers: { "content-type": "application/pdf" } })); },
  }, `https://${tenant}.test/v1/`);
  try {
    await make("first").downloadEvent(59, root);
    await expect(make("second").downloadEvent(59, root)).rejects.toThrow("tenant");
    expect(await readFile(join(root, "event-59", "type-1_file-1_final.pdf"), "utf8")).toBe("%PDF-first");
    expect(await make("first").downloadEvent(59, root)).toEqual({ downloaded: 0, skipped: 1 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("resolves query-only next links against the current page", async () => {
  const { api, urls } = client([{ value: [], "@odata.nextLink": "?$skip=1" }, { value: [] }]);
  await api.listEvents("2021-01-01", "2021-01-01");
  expect(urls[1]).toBe(`${base}Events?$skip=1`);
});

test("rejects unsafe or cyclic pagination before fetching the next page", async () => {
  for (const next of ["https://other.test/v1/Events", "/outside/Events", "https://u:p@example.test/v1/Events", "https://:p@example.test/v1/Events", "Events?x=%2f#fragment", "https://example.test/v1/../Events"]) {
    const { api, urls } = client([{ value: [], "@odata.nextLink": next }]);
    await expect(api.listEvents("2021-01-01", "2021-01-31")).rejects.toThrow("pagination");
    expect(urls).toHaveLength(1);
  }
  const { api } = client([{ value: [], "@odata.nextLink": "Events?$skip=1" }, { value: [], "@odata.nextLink": "Events?$skip=1" }]);
  await expect(api.listEvents("2021-01-01", "2021-01-31")).rejects.toThrow("pagination");
});

test("validates calendar ranges before making requests", async () => {
  for (const [from, to] of [["2021-02-29", "2021-03-01"], ["2021-01-02", "2021-01-01"], ["2021-1-01", "2021-01-01"]]) {
    const { api, urls } = client([]);
    await expect(api.listEvents(from!, to!)).rejects.toThrow("date");
    expect(urls).toHaveLength(0);
  }
});

test("normalizes event fields and validates IDs, dates and published files", async () => {
  const file = { fileId: 157, fileType: 1, type: "Agenda", name: "Final" };
  const { api, urls } = client([{ ...event, publishedFiles: [{ ...file, url: "untrusted" }], extra: "ignored" }]);
  expect(await api.getEvent(59)).toEqual({ ...event, eventDate: "2021-01-05T09:00:00.000Z", publishedFiles: [file] });
  expect(urls).toEqual([`${base}Events/59`]);
  for (const bad of [{ ...event, id: 0 }, { ...event, eventName: null }, { ...event, eventDate: "2021-02-30T09:00:00Z" }, { ...event, publishedFiles: null }, { ...event, publishedFiles: [{ ...file, fileId: 1.5 }] }, { ...event, publishedFiles: [{ ...file, name: null }] }, { ...event, id: 60 }]) {
    await expect(client([bad]).api.getEvent(59)).rejects.toThrow();
  }
  await expect(client([]).api.getEvent(-1)).rejects.toThrow();
  await expect(client([{ value: [null] }]).api.listEvents("2021-01-01", "2021-01-01")).rejects.toThrow();
  await expect(client([{ value: [], "@odata.nextLink": 1 }]).api.listEvents("2021-01-01", "2021-01-01")).rejects.toThrow();
});

test("rejects non-object metadata and invalid event page shapes", async () => {
  for (const metadata of [undefined, null, false, 0, "", "event", []]) {
    await expect(client([metadata]).api.getEvent(59)).rejects.toThrow("invalid metadata object");
    await expect(client([metadata]).api.listEvents("2021-01-01", "2021-01-01")).rejects.toThrow("invalid metadata object");
  }
  await expect(client([{}]).api.getEvent(59)).rejects.toThrow("invalid metadata string");
  for (const value of [undefined, null, {}, "", 0]) {
    await expect(client([{ value }]).api.listEvents("2021-01-01", "2021-01-01")).rejects.toThrow("invalid event page");
  }
  expect(await client([{ value: [] }]).api.listEvents("2021-01-01", "2021-01-01")).toEqual([]);
});

test("rejects zero and invalid IDs before requests or document downloads", async () => {
  for (const id of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const { api, urls } = client([]);
    await expect(api.getEvent(id)).rejects.toThrow("positive ID");
    expect(urls).toEqual([]);
  }
  const file = { fileId: 157, fileType: 1, type: "Agenda", name: "Final" };
  for (const bad of [null, [], {}, { ...file, fileId: 0 }, { ...file, fileType: 0 }]) {
    await expect(client([{ ...event, publishedFiles: [bad] }]).api.getEvent(59)).rejects.toThrow();
  }
});

test("rejects invalid calendar dates and malformed event timestamps", async () => {
  for (const date of ["", "2021-13-01", "2021-00-01", "2021-01-00", "2021-02-29", "2021-1-01", "not-a-date"]) {
    expect(() => calendarDate(date)).toThrow("calendar date");
  }
  expect(calendarDate("2020-02-29")).toBe("2020-02-29");
  for (const eventDate of ["2021-01-05", "2021-01-05Tgarbage", "2021-01-05T25:00:00Z", "2021-02-30T09:00:00Z"]) {
    await expect(client([{ ...event, eventDate }]).api.getEvent(59)).rejects.toThrow("date");
  }
});

test("repairs size-only and hash-only checkpoint mismatches independently", async () => {
  const root = await mkdtemp(join(tmpdir(), "civic-checksum-"));
  const body = "%PDF-fixture";
  let calls = 0;
  const api = new CivicClerkClient({
    async getJson<T>(): Promise<T> { return { ...event, publishedFiles: [{ fileId: 1, fileType: 1, type: "Agenda", name: "Final" }] } as T; },
    async request<T>(_url: string, consume: (response: Response) => Promise<T>): Promise<T> {
      calls++;
      return consume(new Response(body, { headers: { "content-type": "Application/PDF; charset=binary" } }));
    },
  }, base);
  try {
    await api.downloadEvent(59, root);
    const db = new Database(join(root, "civicclerk.sqlite"));
    try { db.run("UPDATE documents SET byte_size=byte_size+1"); } finally { db.close(); }
    expect(await api.downloadEvent(59, root)).toEqual({ downloaded: 1, skipped: 0 });
    await writeFile(join(root, "event-59", "type-1_file-1_final.pdf"), "%PDF-corrupt");
    expect(Buffer.byteLength("%PDF-corrupt")).toBe(Buffer.byteLength(body));
    expect(await api.downloadEvent(59, root)).toEqual({ downloaded: 1, skipped: 0 });
    expect(calls).toBe(3);
    expect(await readFile(join(root, "event-59", "type-1_file-1_final.pdf"), "utf8")).toBe(body);
    expect(await api.downloadEvent(59, root)).toEqual({ downloaded: 0, skipped: 1 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects unsuccessful, missing-type and bodyless PDF responses and persists failures", async () => {
  for (const response of [
    new Response("%PDF-error", { status: 503, headers: { "content-type": "application/pdf" } }),
    new Response(new Uint8Array([1])),
    new Response(null, { status: 404 }),
    new Response(null, { headers: { "content-type": "application/pdf" } }),
  ]) {
    const root = await mkdtemp(join(tmpdir(), "civic-response-"));
    const api = new CivicClerkClient({
      async getJson<T>(): Promise<T> { return { ...event, publishedFiles: [{ fileId: 1, fileType: 1, type: "Agenda", name: "Final" }] } as T; },
      async request<T>(_url: string, consume: (response: Response) => Promise<T>): Promise<T> { return consume(response); },
    }, base);
    try {
      await expect(api.downloadEvent(59, root)).rejects.toThrow(response.ok && response.headers.get("content-type") === "application/pdf" ? "response had no body" : "expected a successful PDF response");
      expect(await readdir(join(root, "event-59"))).toEqual([]);
      if (response.body) expect(response.bodyUsed).toBe(true);
      const db = new Database(join(root, "civicclerk.sqlite"), { readonly: true });
      try {
        expect(db.query("SELECT download_status, error IS NOT NULL AS has_error FROM documents").get()).toEqual({ download_status: "failed", has_error: 1 });
        expect(db.query("SELECT status, error IS NOT NULL AS has_error, finished_at IS NOT NULL AS finished FROM ingest_runs").get()).toEqual({ status: "failed", has_error: 1, finished: 1 });
      } finally { db.close(); }
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("lists published events across relative OData pages with inclusive dates", async () => {
  const { api, urls } = client([{ value: [event], "@odata.nextLink": "Events?$skip=1" }, { value: [{ ...event, id: 60 }] }]);
  expect((await api.listEvents("2021-01-01", "2021-01-31")).map(e => e.id)).toEqual([59, 60]);
  expect(new URL(urls[0]!).searchParams.get("$filter")).toBe("eventDate ge 2021-01-01T00:00:00Z and eventDate lt 2021-02-01T00:00:00Z and isPublished eq 'Published'");
  expect(urls[1]).toBe(`${base}Events?$skip=1`);
});
