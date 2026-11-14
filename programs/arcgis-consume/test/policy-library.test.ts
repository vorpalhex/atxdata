import { test, expect } from "bun:test";
import { main } from "../src/cli";
import { policyFixture } from "./support/policy-fixture";
for (const status of [200, 301, 302, 403, 429, 503])
  test(
    "library inspection and replay share raw receipt contract " + status,
    async () => {
      const f = await policyFixture();
      const args = await f.produce();
      const realNow = Date.now,
        realSleep = Bun.sleep;
      let now = realNow(),
        calls = 0;
      Date.now = () => now;
      Bun.sleep = async (ms) => {
        now += Number(ms);
      };
      try {
        const deps = {
          fetch: async (u: string) => {
            calls++;
            const body = "User-agent: *\nDisallow: /FloodPro/\n";
            return new Response(body, {
              status: u.includes("geohub") ? 200 : status,
              headers: {
                "content-length": String(Buffer.byteLength(body)),
                "content-type": "text/plain",
                ...([301, 302].includes(status)
                  ? { location: "https://geohub.austintexas.gov/" }
                  : {}),
                ...(status === 429 ? { "retry-after": "9" } : {}),
              },
            });
          },
        };
        const r = (await main(args, deps)) as {
          summary: { permission: boolean; navigation: boolean };
          reused: boolean;
        };
        expect(r.summary.permission).toBe(false);
        expect(r.summary.navigation).toBe(false);
        const count = calls;
        expect(
          (
            (await main(args, {
              fetch: async () => {
                throw Error("unexpected reuse HTTP");
              },
            })) as { reused: boolean }
          ).reused,
        ).toBe(true);
        expect(calls).toBe(count);
        await main(["verify", "--archive", f.root]);
      } finally {
        Date.now = realNow;
        Bun.sleep = realSleep;
        f.close();
      }
    },
    15000,
  );
