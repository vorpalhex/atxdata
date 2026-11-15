import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { main } from "../src/cli";
import { terms } from "../src/rules";
import { profileFixture, id, item } from "./support/profile-fixture";
for (const source of ["austin", "water"] as const)
  for (const headers of [
    { "cf-mitigated": "challenge" },
    { "www-authenticate": 'Basic realm="authored fixture"' },
    { "content-type": "text/html" },
  ] as Record<string, string>[])
    test(`${source} refuses challenge/authentication evidence on actual resource403`, async () => {
      const f = profileFixture(
        source,
        new Response("Challenge", { status: 403, headers }),
      );
      const original = f.deps.fetch;
      f.deps.fetch = async (url) =>
        url.startsWith(f.base)
          ? new Response("Challenge", { status: 403, headers })
          : original(url);
      const root = await mkdtemp(
        join(process.env.TMPDIR!, "profile-challenge-"),
      );
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
      ).rejects.toThrow("HTTP 403");
      expect(
        f.calls.filter((u) => new URL(u).pathname.endsWith("/query")),
      ).toEqual([]);
    });
