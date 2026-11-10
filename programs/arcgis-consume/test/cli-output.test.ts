import { test, expect, spyOn } from "bun:test";
import { writeStdout } from "../src/cli-output";

test("imported writer awaits each flush, preserves multibyte chunks and unreferences after delivery", async () => {
  const chunks: Buffer[] = [],
    events: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sink = {
    write: async (bytes: Uint8Array) => {
      events.push("write");
      chunks.push(Buffer.from(bytes));
    },
    flush: async () => {
      events.push("flush");
      if (chunks.length === 1) await blocked;
    },
    unref: () => {
      events.push("unref");
    },
  };
  const writer = spyOn(Bun.stdout, "writer").mockReturnValue(
    sink as unknown as ReturnType<typeof Bun.stdout.writer>,
  );
  try {
    const text = "é☃".repeat(30000);
    const delivery = writeStdout(text);
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["write", "flush"]);
    expect(chunks).toHaveLength(1);
    release();
    await delivery;
    expect(writer).toHaveBeenCalledWith({ highWaterMark: 65536 });
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(text));
    expect(chunks.map((c) => c.length)).toEqual([65536, 65536, 18928]);
    expect(events).toEqual([
      "write",
      "flush",
      "write",
      "flush",
      "write",
      "flush",
      "unref",
    ]);
    chunks.length = 0;
    events.length = 0;
    await writeStdout("");
    expect(chunks).toEqual([]);
    expect(events).toEqual(["unref"]);
  } finally {
    release();
    writer.mockRestore();
  }
});

test("imported writer classifies delivery failures without leaking private error text", async () => {
  for (const stage of ["write", "flush"]) {
    for (const [code, expected] of [
      ["EPIPE", null],
      ["EBADF", "EBADF"],
      ["ENOSPC", "ENOSPC"],
      ["private path /secret", "EIO"],
      [undefined, "EIO"],
    ] as const) {
      let unrefs = 0;
      const fail = () => {
        throw Object.assign(Error("private body /secret"), { code });
      };
      const sink = {
        write: async () => {
          if (stage === "write") fail();
        },
        flush: async () => {
          if (stage === "flush") fail();
        },
        unref: () => {
          unrefs++;
        },
      };
      const writer = spyOn(Bun.stdout, "writer").mockReturnValue(
        sink as unknown as ReturnType<typeof Bun.stdout.writer>,
      );
      try {
        if (expected === null)
          await expect(writeStdout("result")).resolves.toBeUndefined();
        else
          await expect(writeStdout("result")).rejects.toThrow(
            `stdout delivery failed (${expected}); completed archive facts are retained`,
          );
        expect(unrefs).toBe(1);
      } finally {
        writer.mockRestore();
      }
    }
  }
});
