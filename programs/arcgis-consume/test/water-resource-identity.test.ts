import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { main } from "../src/cli";
import { terms } from "../src/rules";
import { profileFixture, id, item } from "./support/profile-fixture";
test("Water rejects a map feature reference resolving to a file before file acquisition", async () => {
  const f = profileFixture("water", "User-agent: *\nAllow: /\n"),
    original = f.deps.fetch;
  let files = 0;
  const bytes = "VALUE\nfixture-only\n";
  f.deps.fetch = async (url: string) => {
    const path = new URL(url).pathname;
    if (path.endsWith(id + "/data")) {
      files++;
      return new Response(bytes);
    }
    if (path.endsWith(id))
      return Response.json({
        ...item,
        type: "CSV",
        url: undefined,
        name: "fixture.csv",
        size: Buffer.byteLength(bytes),
        created: 1,
      });
    return original(url);
  };
  const root = await mkdtemp(join(process.env.TMPDIR!, "water-file-mismatch-"));
  await expect(
    main(
      [
        "collect",
        "--source",
        "water",
        "--item",
        id,
        "--layer",
        "7",
        "--archive",
        root,
        "--terms-sha256",
        terms(item).sha256,
      ],
      f.deps,
    ),
  ).rejects.toThrow("Water catalog feature identity mismatch");
  expect(files).toBe(0);
});
