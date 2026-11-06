import { lstat, mkdir, open, readFile, unlink, link } from "node:fs/promises";
import { isAbsolute, parse, resolve, dirname, join } from "node:path";
import { saveResponse } from "../../legistar-consume/src/ingest/downloader";

export async function statFile(path: string) {
  const stat = await lstat(path).catch(error => { if (error.code !== "ENOENT") throw error; return undefined; });
  if (stat?.isSymbolicLink()) throw new Error("unsafe symlink in output");
  return stat;
}
export async function archiveLock(output: string): Promise<() => Promise<void>> {
  if (!isAbsolute(output) || output !== resolve(output) || resolve(output) === parse(output).root) throw new Error("archive root must be a non-root absolute path");
  for (let path = resolve(output); path !== dirname(path); path = dirname(path)) await statFile(path);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const path = join(output, ".civicclerk.lock"), token = JSON.stringify({ token: crypto.randomUUID(), pid: process.pid, startedAt: new Date().toISOString() });
  const lock = await open(path, "wx", 0o600);
  try { await lock.writeFile(token); } finally { await lock.close(); }
  return async () => { if (await readFile(path, "utf8") === token) await unlink(path); };
}
export async function promote(path: string): Promise<void> {
  await link(`${path}.pending`, path); // Atomic no-clobber promotion, unlike rename.
  await unlink(`${path}.pending`);
}
function requirePdf(response: Response): asserts response is Response & { body: ReadableStream<Uint8Array> } {
  if (!response.ok || response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/pdf") throw new Error("expected a successful PDF response");
  if (!response.body) throw new Error("response had no body");
}
export async function savePdf(response: Response, path: string, maxBytes: number) {
  try { requirePdf(response); } catch (error) { await response.body?.cancel(); throw error; }
  let bytes = 0;
  const meter = new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
    bytes += chunk.byteLength;
    if (bytes > maxBytes) throw new Error("PDF byte ceiling exceeded");
    controller.enqueue(chunk);
  } });
  const pending = `${path}.pending`;
  try {
    const written = await saveResponse(new Response(response.body.pipeThrough(meter)), pending, `${path}.part`);
    const handle = await open(pending, "r");
    const signature = Buffer.alloc(5);
    try { await handle.read(signature, 0, 5, 0); await handle.sync(); } finally { await handle.close(); }
    if (signature.toString() !== "%PDF-") throw new Error("invalid PDF signature");
    return written;
  } catch (error) { await unlink(pending).catch(() => {}); throw error; }
}
