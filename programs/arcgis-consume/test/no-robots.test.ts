import { expect, test } from "bun:test";
import { mkdtemp, realpath } from "node:fs/promises";
import { join } from "node:path";
import { main } from "../src/cli";
import { terms } from "../src/rules";
import { profileFixture, id, item } from "./support/profile-fixture";

for (const source of ["austin", "water"] as const)
  test(`${source} collects and verifies without requesting robots`, async () => {
    const f = profileFixture(source, "User-agent: *\nDisallow: /\n");
    const fetch = f.deps.fetch;
    f.deps.fetch = async (url) => {
      if (new URL(url).pathname === "/robots.txt")
        throw new Error("robots request forbidden");
      return fetch(url);
    };
    const root = await mkdtemp(
      join(await realpath(process.env.TMPDIR!), "no-robots-"),
    );
    await main(
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
    );
    await main(["verify", "--archive", root], {
      ...f.deps,
      fetch: async () => {
        throw Error("offline");
      },
    });
    expect(f.calls.some((url) => new URL(url).pathname === "/robots.txt")).toBe(
      false,
    );
    expect(
      f.calls.some((url) => new URL(url).pathname.endsWith("/query")),
    ).toBe(true);
  });
