import { test, expect } from "bun:test";
import { cooldown } from "../src/cooldown";
test("relative reset cannot be masked by another policy, expired dates do not create a delay, malformed exhaustion stops", () => {
  expect(
    cooldown(
      new Headers({ "RateLimit-Remaining": "0", "RateLimit-Reset": "9" }),
      1000,
    ),
  ).toBe(10000);
  expect(
    cooldown(
      new Headers({
        Date: "Mon, 01 Jan 2024 00:00:10 GMT",
        "Retry-After": "Mon, 01 Jan 2024 00:00:00 GMT",
      }),
      1000,
    ),
  ).toBe(1000);
  for (const headers of [
    { "RateLimit-Remaining": "0", "RateLimit-Reset": "" },
    { "RateLimit-Remaining": "oops" },
  ] as Record<string, string>[])
    expect(() => cooldown(new Headers(headers), 0)).toThrow("cooldown");
});
test("honors successful response cooldown without capping and rejects uninterpretable exhaustion", () => {
  expect(cooldown(new Headers({ "Retry-After": "999999" }), 0)).toBe(999999000);
  expect(
    cooldown(
      new Headers({
        Date: "Mon, 01 Jan 2024 00:00:00 GMT",
        "Retry-After": "Mon, 01 Jan 2024 00:00:10 GMT",
      }),
      1000,
    ),
  ).toBe(11000);
  expect(
    cooldown(
      new Headers({
        "RateLimit-Remaining": "0",
        "RateLimit-Reset": "9",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": "20",
      }),
      1000,
    ),
  ).toBe(20000);
  expect(cooldown(new Headers({ RateLimit: '"quota";r=0;t=30' }), 1000)).toBe(
    31000,
  );
  const invalid: Record<string, string>[] = [
    { "Retry-After": "garbage" },
    { "RateLimit-Remaining": "0" },
    { RateLimit: '"quota";r=0' },
  ];
  for (const h of invalid)
    expect(() => cooldown(new Headers(h), 0)).toThrow("cooldown");
});
