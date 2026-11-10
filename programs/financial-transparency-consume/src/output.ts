import { write } from "node:fs";
export class OutputFailure extends Error {
  constructor(
    readonly brokenPipe: boolean,
    readonly timedOut = false,
  ) {
    super("output delivery failed");
  }
}
function writeChunk(bytes: Uint8Array): Promise<number> {
  return new Promise((resolve, reject) =>
    write(1, bytes, (error, count) => (error ? reject(error) : resolve(count))),
  );
}
type Writer = (bytes: Uint8Array) => number | Promise<number>;
// One attempt owns error classification and the bounded transient retry delay.
// Undefined means retry; invalid numeric progress is checked by the offset loop.
async function writeAttempt(
  chunk: Uint8Array,
  writer: Writer,
  deadline: Promise<never>,
): Promise<{ count: number } | undefined> {
  try {
    const count = await Promise.race([
      Promise.resolve().then(() => writer(chunk)),
      deadline,
    ]);
    return { count };
  } catch (error) {
    if (error instanceof OutputFailure) throw error;
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "EAGAIN" || code === "EWOULDBLOCK" || code === "EINTR") {
      await Promise.race([
        new Promise((resolve) => setTimeout(resolve, 10)),
        deadline,
      ]);
      return;
    }
    throw new OutputFailure(code === "EPIPE");
  }
}
// Shared native importer/acquisition delivery. No hidden stdout buffer remains;
// deadline includes blocking pipes, not only EAGAIN. Timeout terminates the
// outstanding native worker after diagnostics, never repeats domain operations.
export async function writeOutput(text: string, writer: Writer = writeChunk) {
  const bytes = Buffer.from(text + "\n");
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new OutputFailure(false, true)), 5000);
  });
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const chunk = bytes.subarray(
        offset,
        Math.min(offset + 65536, bytes.length),
      );
      const attempt = await writeAttempt(chunk, writer, deadline);
      if (attempt === undefined) continue;
      const { count } = attempt;
      if (!Number.isInteger(count) || count <= 0 || count > chunk.length)
        throw new OutputFailure(false);
      offset += count;
    }
  } finally {
    clearTimeout(timer!);
  }
}
export function outputStatus(
  error: OutputFailure,
  completedExit: number,
  diagnose: (text: string) => void = console.error,
) {
  if (error.brokenPipe) return completedExit;
  diagnose(
    "financial-transparency-consume: output delivery failed; check stdout destination. Completed archive work is retained.",
  );
  return 1;
}
