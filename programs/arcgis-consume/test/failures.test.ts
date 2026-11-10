import { test, expect } from "bun:test";
import {
  mkdtemp,
  chmod,
  rm,
  symlink,
  readFile,
  writeFile,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Archive, limits } from "../src/archive";
async function fixture(
  fetch: (url: string, init: RequestInit) => Promise<Response>,
) {
  const root = await mkdtemp(join(process.env.TMPDIR!, "arcgis-failure-"));
  let now = 0;
  const a = await Archive.open(root, {
    fetch,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    random: () => 0,
  });
  a.store.source("fixture", "fixture", "https://example.invalid");
  return {
    root,
    a,
    run: a.store.start("fixture", "collect"),
    clean: async () => {
      await a.close();
      await rm(root, { recursive: true });
    },
  };
}
test("published bytes with HTML content type are not accepted as a ZIP", async () => {
  const f = await fixture(
    async () =>
      new Response(new Uint8Array([80, 75, 3, 4]), {
        headers: { "content-type": "text/html" },
      }),
  );
  try {
    await expect(
      f.a.request(f.run, "zip", "https://example.invalid", "zip"),
    ).rejects.toThrow("ZIP content type");
    expect(f.a.store.status().observations).toBe(0);
  } finally {
    await f.clean();
  }
});
test("HTTP200 ArcGIS errors and malformed JSON do not promote or retry", async () => {
  for (const body of ['{"error":{"code":400}}', '{"broken"']) {
    let calls = 0;
    const f = await fixture(async () => {
      calls++;
      return new Response(body);
    });
    try {
      await expect(
        f.a.request(f.run, "bad", "https://example.invalid", "json"),
      ).rejects.toThrow();
      expect(calls).toBe(1);
      expect(f.a.store.status().observations).toBe(0);
      expect(f.a.store.budget(f.run).bytes).toBe(body.length);
    } finally {
      await f.clean();
    }
  }
});
test("transient retries are bounded, server cooldown persists after successful headers, byte ceilings stop permanently", async () => {
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    return calls < 3
      ? new Response("busy", { status: 503, headers: { "Retry-After": "8" } })
      : Response.json({ ok: true });
  });
  try {
    expect(
      await f.a.request(f.run, "retry", "https://example.invalid", "json"),
    ).toEqual({ ok: true });
    expect(calls).toBe(3);
    expect(f.a.store.status().attempts).toBe(3);
  } finally {
    await f.clean();
  }
  const over = await fixture(
    async () => new Response(new Uint8Array(limits.responseBytes + 1)),
  );
  try {
    await expect(
      over.a.request(over.run, "over", "https://example.invalid", "json"),
    ).rejects.toThrow("byte ceiling");
    expect(over.a.store.status().observations).toBe(0);
    expect(over.a.store.status().attempts).toBe(1);
  } finally {
    await over.clean();
  }
});
test("writer overlap and symlink roots stop without touching targets", async () => {
  const f = await fixture(async () => Response.json({}));
  try {
    await expect(Archive.open(f.root)).rejects.toThrow();
    await symlink(f.root, f.root + "-link");
    await expect(Archive.open(f.root + "-link")).rejects.toThrow("symlink");
    await unlink(f.root + "-link");
  } finally {
    await f.clean();
  }
});
test("checkpoint-before-promotion interruption recovers offline without clobbering", async () => {
  const f = await fixture(async () => {
    throw new Error("zero HTTP required");
  });
  try {
    const body = Buffer.from('{"checkpoint":true}'),
      path = "checkpoint.body";
    await writeFile(join(f.root, path + ".pending"), body, { flag: "wx" });
    f.a.store.checkpoint({
      run: f.run,
      label: "checkpoint",
      url: "https://example.invalid",
      sha256: createHash("sha256").update(body).digest("hex"),
      bytes: body.length,
      path,
      status: "pending",
      kind: "json",
      retrieved: new Date(0).toISOString(), // fixture archive uses controlled epoch0
    });
    expect(
      await f.a.request(f.run, "checkpoint", "https://example.invalid", "json"),
    ).toEqual({ checkpoint: true });
    expect(f.a.store.status().attempts).toBe(0);
    expect(f.a.store.observation(f.run, "checkpoint")!.status).toBe("ready");
    expect(await readFile(join(f.root, path))).toEqual(body);
  } finally {
    await f.clean();
  }
});
test("downstream write failure cancels pending or buffered native ownership exactly once and releases it", async () => {
  for (const buffered of [false, true]) {
    let sourceCanceled = 0,
      cancels = 0,
      releases = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (buffered) controller.enqueue(new Uint8Array(65536));
        else return new Promise(() => {});
      },
      cancel() {
        sourceCanceled++;
      },
    });
    const getReader = body.getReader.bind(body);
    Object.defineProperty(body, "getReader", {
      value: () => {
        const reader = getReader();
        const cancel = reader.cancel.bind(reader),
          release = reader.releaseLock.bind(reader);
        reader.cancel = (reason) => {
          cancels++;
          return cancel(reason);
        };
        reader.releaseLock = () => {
          releases++;
          release();
        };
        return reader;
      },
    });
    const f = await fixture(async () => new Response(body));
    try {
      await chmod(f.root, 0o500);
      await expect(
        f.a.request(f.run, "write-failure", "https://example.invalid", "text"),
      ).rejects.toThrow("EACCES");
      expect(sourceCanceled).toBe(1);
      expect(cancels).toBe(1);
      expect(releases).toBe(1);
      expect(body.locked).toBe(false);
    } finally {
      await chmod(f.root, 0o700);
      await f.clean();
    }
  }
}, 5000);
test("natural EOF releases native ownership once without cancellation", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("complete"));
      controller.close();
    },
  });
  const getReader = body.getReader.bind(body);
  let cancels = 0,
    releases = 0;
  // Observe the real reader's lifecycle without replacing stream semantics.
  Object.defineProperty(body, "getReader", {
    value: () => {
      const reader = getReader();
      const cancel = reader.cancel.bind(reader),
        release = reader.releaseLock.bind(reader);
      reader.cancel = (reason) => {
        cancels++;
        return cancel(reason);
      };
      reader.releaseLock = () => {
        releases++;
        release();
      };
      return reader;
    },
  });
  const f = await fixture(async () => new Response(body));
  try {
    expect(
      await f.a.request(f.run, "eof", "https://example.invalid", "text"),
    ).toBe("complete");
    expect(cancels).toBe(0);
    expect(releases).toBe(1);
    expect(body.locked).toBe(false);
  } finally {
    await f.clean();
  }
});
test("errored upstream reader is released after downstream settlement", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("upstream failure"));
    },
  });
  const f = await fixture(async () => new Response(body));
  try {
    await expect(
      f.a.request(f.run, "error", "https://example.invalid", "text"),
    ).rejects.toThrow("upstream failure");
    expect(body.locked).toBe(false);
  } finally {
    await f.clean();
  }
});
test("stream interruption retains failed attempt and no completed checkpoint", async () => {
  const f = await fixture(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"a":'));
            controller.error(new Error("interrupted"));
          },
        }),
      ),
  );
  try {
    await expect(
      f.a.request(f.run, "interrupt", "https://example.invalid", "json"),
    ).rejects.toThrow("interrupted");
    expect(f.a.store.status().attempts).toBe(1);
    expect(f.a.store.status().observations).toBe(0);
  } finally {
    await f.clean();
  }
});
