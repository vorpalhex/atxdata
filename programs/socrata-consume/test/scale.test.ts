import { test, expect } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { collect, verify } from "../src/collector";
import { fixture } from "./support/fixture";
const base = process.env.SOCRATA_TEST_ROOT;
if (!base) throw Error("set SOCRATA_TEST_ROOT");

test("non-sample asset and full-asset authored scale exceed demonstration row/page bounds", async () => {
  const root = await mkdtemp(join(base, "scale-")),
    f = fixture("abcd-1234", 20001, null);
  const options = { root, asset: "abcd-1234", maxRows: 30000, pageSize: 10000 };
  const result = await collect(options, f.deps);
  expect(result).toMatchObject({
    rows: 20001,
    sourceCount: "20001",
    wholeAsset: true,
    status: "complete",
  });
  expect(
    f.calls
      .filter((u) => new URL(u).searchParams.has("$offset"))
      .map((u) => new URL(u).searchParams.get("$offset")),
  ).toEqual(["0", "10000", "20000", "20001"]);
  const count = f.calls.length;
  expect(await verify(root)).toMatchObject({ rows: 20001 });
  expect((await collect(options, f.deps)).reused).toBe(true);
  expect(f.calls.length).toBe(count);
});

test("empty selected dataset requires actual terminal evidence and completes zero rows honestly", async () => {
  const root = await mkdtemp(join(base, "empty-")),
    f = fixture("abcd-1234", 0, null);
  const result = await collect(
    { root, asset: "abcd-1234", maxRows: 1 },
    f.deps,
  );
  expect(result).toMatchObject({
    rows: 0,
    sourceCount: "0",
    status: "complete",
  });
  expect(await verify(root)).toMatchObject({ rows: 0, snapshots: 1 });
});
