import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { main } from "../src/cli";
import { terms } from "../src/rules";
import {
  profileFixture,
  id,
  item,
  city,
  water,
} from "./support/profile-fixture";

for (const source of ["austin", "water"] as const) {
  const base = source === "austin" ? city : water;
  const route = new URL(base + "/7/query").pathname;
  for (const policy of [
    `User-agent: *\nDisallow: ${route}\n`,
    `User-agent: *\nAllow: /\n\nUser-agent: atxdata-arcgis\nDisallow: ${route}\n`,
  ])
    test(`${source} denies prohibited feature queries before dispatch`, async () => {
      const f = profileFixture(source, policy),
        root = await mkdtemp(join(process.env.TMPDIR!, "profile-deny-"));
      await expect(
        main(
          [
            "collect",
            "--source",
            source,
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
      ).rejects.toThrow("robots disallows");
      expect(
        f.calls.filter((u) => new URL(u).pathname.endsWith("/query")),
      ).toEqual([]);
    });
}
