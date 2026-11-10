import { test, expect } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { main } from "../src/cli";
import { configs } from "../src/sources";
import { terms } from "../src/rules";
import { fixture, id, item, service } from "./support/selection-fixture";
import { Archive } from "../src/archive";
import { sourcePolicy } from "../src/profile-policy";
test("unavailable robots outcome never grants permission across a retained manual stop", async () => {
  const root = await temp("policy-stop-"),
    { f, args } = cityFixture();
  const result: any = await main(args(root), f.deps);
  const a = await Archive.open(root, f.deps);
  a.store.defer(Number.MAX_SAFE_INTEGER);
  expect(() => sourcePolicy(a, result.run)).toThrow("manual review");
  await a.close();
});
const city =
  "https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/Other_Boundary/FeatureServer";
function cityFixture(
  robotsStatus = 403,
  headers: Record<string, string> = {},
  denyResource = false,
) {
  const f = fixture(),
    original = f.deps.fetch,
    calls: Array<{ url: string; at: number }> = [];
  f.deps.fetch = async (url: string) => {
    calls.push({ url, at: f.deps.now() });
    if (url === "https://services.arcgis.com/robots.txt")
      return new Response("Invalid URL", { status: robotsStatus, headers });
    if (denyResource && url.startsWith(city))
      return new Response("Denied", { status: 403 });
    const response = await original(
      url.replace(configs.austin.site, configs.tnr.site).replace(city, service),
    );
    if (url.endsWith("robots.txt")) return response;
    return new Response(
      (await response.text())
        .replaceAll(configs.tnr.site, configs.austin.site)
        .replaceAll(service, city),
      { status: response.status, headers: response.headers },
    );
  };
  return {
    f,
    calls,
    args: (root: string) => [
      "collect",
      "--source",
      "austin",
      "--item",
      id,
      "--layer",
      "7",
      "--archive",
      root,
      "--terms-sha256",
      terms(item).sha256,
    ],
  };
}
const temp = (name: string) => mkdtemp(join(process.env.TMPDIR!, name));
test("robots403 outcome is original failed status, not a synthetic successful robots body", async () => {
  const root = await temp("outcome-"),
    { f, args } = cityFixture();
  const result: any = await main(args(root), f.deps);
  expect(result.summary.sourcePolicy).toMatchObject({
    version: 1,
    unavailable: [
      {
        kind: "robots-unavailable",
        url: "https://services.arcgis.com/robots.txt",
        status: 403,
        bodyRetained: false,
      },
    ],
  });
  const a = await Archive.open(root, f.deps);
  expect(
    a.store.db
      .query("SELECT status,error FROM attempts WHERE status=403")
      .get(),
  ).toEqual({ status: 403, error: "HTTP 403" });
  expect(
    a.store.db
      .query(
        "SELECT 1 FROM observations WHERE label='robots-services.arcgis.com'",
      )
      .get(),
  ).toBeNull();
  await a.close();
});
test("robots403 honors header hold; actual resource403,429,5xx and malformed holds stop", async () => {
  const root = await temp("hold-"),
    ok = cityFixture(403, { "retry-after": "60" });
  await main(ok.args(root), ok.f.deps);
  const index = ok.calls.findIndex(
    (v) => v.url === "https://services.arcgis.com/robots.txt",
  );
  expect(ok.calls[index + 1]!.at - ok.calls[index]!.at).toBeGreaterThanOrEqual(
    60000,
  );
  for (const [status, headers, resource, reason] of [
    [429, {}, false, "HTTP 429"],
    [503, {}, false, "HTTP 503"],
    [403, { "retry-after": "nonsense" }, false, "cooldown"],
    [403, {}, true, "HTTP 403"],
  ] as const) {
    const failed = cityFixture(status, headers, resource),
      archive = await temp("denied-");
    await expect(main(failed.args(archive), failed.f.deps)).rejects.toThrow(
      reason,
    );
    expect(failed.calls.filter((v) => v.url.includes("/query"))).toHaveLength(
      0,
    );
  }
});
test("Austin resume reuses unavailable403 and settled pages; sync retains history; corrupt original fails offline", async () => {
  const root = await temp("city-resume-"),
    { f, calls, args } = cityFixture();
  f.interrupt = true;
  await expect(main(args(root), f.deps)).rejects.toThrow(
    "fixture interruption",
  );
  let a = await Archive.open(root, f.deps);
  const run: any = a.store.db
    .query("SELECT id FROM runs WHERE status='failed'")
    .get();
  await a.close();
  f.interrupt = false;
  await main([...args(root), "--resume", run.id], f.deps);
  expect(
    calls.filter((v) => v.url === "https://services.arcgis.com/robots.txt"),
  ).toHaveLength(1);
  await main(["sync", ...args(root).slice(1)], f.deps);
  a = await Archive.open(root, f.deps);
  const row: any = a.store.db
    .query("SELECT path FROM observations WHERE run=? AND label='page-0'")
    .get(run.id);
  expect(a.store.completed()).toHaveLength(2);
  await a.close();
  const path = join(root, row.path),
    original = await readFile(path),
    before = calls.length;
  await writeFile(path, Buffer.concat([original, Buffer.from(" ")]));
  await expect(main(["verify", "--archive", root], f.deps)).rejects.toThrow();
  expect(calls.length).toBe(before);
  await writeFile(path, original);
  expect(
    ((await main(["verify", "--archive", root], f.deps)) as any).collections,
  ).toBe(2);
});
