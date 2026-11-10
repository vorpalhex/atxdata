import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, writeFile, readFile, cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
test("spawned shipped CLI discovery acquisition refresh reuse and offline safety faults stay loopback-only", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR!, "tcad-native-")),
    output = join(root, "out"),
    cli = resolve(import.meta.dir, "../src/cli.ts");
  const zipped = (text: string) => {
    const p = Bun.spawnSync([
      "python3",
      "-c",
      "import zipfile,sys,io;b=io.BytesIO();z=zipfile.ZipFile(b,'w');z.writestr('X.TXT',sys.argv[1]);z.close();sys.stdout.buffer.write(b.getvalue())",
      text,
    ]);
    if (p.exitCode) throw Error("fixture zip");
    return p.stdout;
  };
  const firstBytes = zipped("a\nb"),
    secondBytes = zipped("changed\n");
  let body = firstBytes;
  const calls: { path: string; time: number }[] = [],
    receipts: any[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (r) => {
      const path = new URL(r.url).pathname;
      calls.push({ path, time: Date.now() });
      return new Response(
        path === "/robots.txt"
          ? "User-agent: *\nDisallow:\nCrawl-delay: 3"
          : path === "/publicinformation"
            ? "<a href=/wp-content/largefiles/current.zip>Current</a>"
            : new Uint8Array(body),
        { headers: { "x-fixture": "portable-native" } },
      );
    },
  });
  const preload = join(root, "preload.ts");
  await writeFile(
    preload,
    `const native=globalThis.fetch;globalThis.fetch=((value:any,options:any)=>{const u=new URL(String(value));if(u.origin!=='https://traviscad.org')throw Error('fixture authority');return native('http://127.0.0.1:${server.port}'+u.pathname,options);}) as typeof fetch;`,
  );
  async function command(name: string, args: string[], expected = 0) {
    const cmd = [process.execPath, "--preload", preload, cli, ...args],
      p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    await writeFile(join(root, name + ".stdout"), stdout);
    await writeFile(join(root, name + ".stderr"), stderr);
    receipts.push({ name, command: cmd, exit, expected });
    expect(exit).toBe(expected);
    return exit === 0 ? JSON.parse(stdout) : null;
  }
  const acquireArgs = (dir: string, id: string) => [
    "acquire",
    "--output",
    dir,
    "--id",
    id,
    "--max-requests",
    "1",
    "--max-bytes",
    "4096",
  ];
  try {
    const links = await command("discover", [
        "discover",
        "--output",
        output,
        "--max-requests",
        "2",
        "--max-bytes",
        "4096",
      ]),
      id = links[0].id;
    const first = await command("acquire", acquireArgs(output, id)),
      n = calls.length;
    expect((await command("reuse", acquireArgs(output, id))).reused).toBe(true);
    expect(calls.length).toBe(n);
    expect(
      (
        await command("explicit-false", [
          ...acquireArgs(output, id),
          "--refresh",
          "false",
        ])
      ).reused,
    ).toBe(true);
    expect(calls.length).toBe(n);
    body = secondBytes;
    const second = await command("refresh", [
      ...acquireArgs(output, id),
      "--refresh",
      "true",
    ]);
    expect(second.hash).not.toBe(first.hash);
    expect(second.path).not.toBe(first.path);
    expect(
      createHash("sha256")
        .update(await readFile(join(output, first.path)))
        .digest("hex"),
    ).toBe(first.hash);
    const db = new Database(join(output, "state.sqlite"));
    expect(
      db.query<any, []>("SELECT count(*) n FROM acquisition_versions").get().n,
    ).toBe(2);
    const ledger = db
      .query<any, []>("SELECT started,finished FROM requests ORDER BY rowid")
      .all();
    for (let i = 1; i < ledger.length; i++)
      expect(ledger[i].started - ledger[i - 1].finished).toBeGreaterThanOrEqual(
        3000,
      );
    const context = JSON.parse(
      db.query<any, []>("SELECT context FROM catalog_observations").get()
        .context,
    );
    expect(context.kind).toBe("http");
    expect(context.requestId).toBeString();
    db.close();
    for (const fault of ["ledger", "delay", "context"]) {
      const dir = join(root, "fault-" + fault);
      await cp(output, dir, { recursive: true });
      const d = new Database(join(dir, "state.sqlite"));
      if (fault === "ledger")
        d.exec("PRAGMA foreign_keys=OFF;DROP TABLE requests");
      if (fault === "delay")
        d.query("UPDATE request_policy SET delay_ms=0").run();
      if (fault === "context") {
        d.exec("DROP TRIGGER catalog_observations_UPDATE");
        d.query("UPDATE catalog_observations SET context=?").run(
          JSON.stringify({ ...context, status: 403 }),
        );
      }
      d.close();
      const before = calls.length;
      await command(
        "fault-" + fault,
        fault === "ledger"
          ? ["verify-members", "--output", dir]
          : acquireArgs(dir, id),
        1,
      );
      expect(calls.length).toBe(before);
    }
    const archive = join(root, "finite.zip"),
      memberOutput = join(root, "members");
    await writeFile(archive, firstBytes);
    const imp = [
      "import-member",
      "--archive",
      archive,
      "--snapshot",
      "label",
      "--member",
      "X.TXT",
      "--start",
      "1",
      "--count",
      "2",
      "--max-expanded",
      "4096",
      "--max-seconds",
      "10",
      "--output",
      memberOutput,
    ];
    const finite = await command("finite-import", imp);
    expect(finite.complete).toBe(false);
    expect(finite.crcVerified).toBe(true);
    await command("finite-verify", [
      "verify-members",
      "--output",
      memberOutput,
    ]);
    expect((await command("finite-reuse", imp)).crcVerified).toBe(true);
    const full = await command(
      "full-import",
      imp.map((v, i) => (i > 0 && imp[i - 1] === "--count" ? "all" : v)),
    );
    const d = new Database(join(memberOutput, "state.sqlite"));
    d.query("UPDATE member_versions SET crc_verified=0 WHERE id=?").run(
      full.version,
    );
    d.close();
    await command(
      "full-crc-fault",
      ["verify-members", "--output", memberOutput],
      1,
    );
  } finally {
    server.stop(true);
    await writeFile(
      join(root, "receipts.json"),
      JSON.stringify({ receipts, calls, publicRequests: 0 }, null, 2),
    );
  }
}, 60000);
