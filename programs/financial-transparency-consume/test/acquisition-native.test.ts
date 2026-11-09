import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

test("OS denies public transport, allows bounded localhost native streaming in separate CLI process", async () => {
  const denied = Bun.spawnSync([
    "/usr/bin/python3",
    "-c",
    "import socket; s=socket.socket(); s.settimeout(1)\ntry:s.connect(('192.0.2.1',443));print('CONNECTED')\nexcept OSError as e:print(e.errno)",
  ]);
  expect(denied.stdout.toString().trim()).toBe("1");
  const root = mkdtempSync(join(process.env.FINANCIAL_TEST_ROOT!, "native-"));
  const sourceArchive = join(root, "source"),
    output = join(root, "import");
  for (const dir of [sourceArchive, output]) mkdirSync(dir, { mode: 0o700 });
  const requests: { method: string; path: string; time: number }[] = [];
  const header =
    "Fiscal Year,Payment Date,Payment #,Vendor Number & Name,Invoice #,Amount,Purchainging Order #,Department,Fund,Expenditure Category,Acct LineItem,Description,EncashmentDate";
  const body = `${header}\n1997,1997-01-01,0001,Authored,0002,1.01,,A,001,Example,002,${"x".repeat(3_300_000)},\n`;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      requests.push({ method: request.method, path, time: Date.now() });
      if (path === "/robots.txt") return new Response("", { status: 404 });
      return new Response(request.method === "HEAD" ? null : body, {
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(Buffer.byteLength(body)),
        },
      });
    },
  });
  const childScript = `import {runAcquisitionCli} from ${JSON.stringify(join(import.meta.dir, "../src/acquisition-cli.ts"))};const deps={fetch:(url,init)=>{if(init.redirect!=='manual')throw new Error('not manual');return fetch(${JSON.stringify(server.url.origin)}+new URL(url).pathname,init);}};process.exitCode=await runAcquisitionCli(JSON.parse(process.argv[1]),console.log,deps);`;
  async function run(args: string[]) {
    const child = Bun.spawn(
      [process.execPath, "-e", childScript, JSON.stringify(args)],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [exit, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(stderr).toBe("");
    return { exit, result: JSON.parse(stdout) };
  }
  try {
    const common = [
      "--source-archive",
      sourceArchive,
      "--fiscal-year",
      "1997",
      "--max-requests",
      "3",
      "--max-bytes",
      "4000000",
      "--max-total-bytes",
      "5000000",
      "--max-rows",
      "2",
    ];
    expect(await run(["discover", ...common])).toMatchObject({
      exit: 0,
      result: {
        candidates: [
          {
            fiscalYear: 1997,
            status: "metadata_available",
            contentValidated: false,
          },
        ],
      },
    });
    expect(await run(["acquire", ...common, "--output", output])).toMatchObject(
      { exit: 0, result: { accepted: 1, reused: false } },
    );
    const before = requests.length;
    expect(await run(["collect", ...common, "--output", output])).toMatchObject(
      { exit: 0, result: { accepted: 1, reused: true } },
    );
    expect(
      await run([
        "verify-source",
        "--source-archive",
        sourceArchive,
        "--output",
        output,
      ]),
    ).toMatchObject({ exit: 0, result: { bindings: 1, httpRequests: 0 } });
    expect(requests).toHaveLength(before);
    expect(requests.map((row) => row.method)).toEqual(["GET", "HEAD", "GET"]);
    for (let i = 1; i < requests.length; i++)
      expect(requests[i].time - requests[i - 1].time).toBeGreaterThanOrEqual(
        3000,
      );
    const db = new Database(join(sourceArchive,"state.sqlite"));
    expect((db.query("SELECT count(*) n FROM timing_events").get() as {n:number}).n).toBeGreaterThan(0);
    db.exec("UPDATE observations SET retrieved='2077-01-01T00:00:00.000Z'; UPDATE versions SET first_retrieved='2077-01-01T00:00:00.000Z'; UPDATE cooldown SET not_before=3376684803000");
    db.close();
    const durable = () => readdirSync(sourceArchive).filter(name=>!name.endsWith('-shm')).sort().map(name=>[name,createHash('sha256').update(readFileSync(join(sourceArchive,name))).digest('hex')]);
    const corrupt = durable();
    expect(await run(['verify-source','--source-archive',sourceArchive,'--output',output])).toMatchObject({exit:1,result:{error:'operation_failed'}});
    expect(await run(['collect',...common,'--output',output])).toMatchObject({exit:1,result:{error:'operation_failed'}});
    expect(requests).toHaveLength(before);
    expect(durable()).toEqual(corrupt);
  } finally {
    server.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);
