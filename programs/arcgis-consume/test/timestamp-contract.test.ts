import { test, expect } from "bun:test";
import { timestamp } from "../src/timing";
import { Store } from "../src/store";

function message(action: () => void) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return (error as Error).message;
  }
  throw new Error("validation unexpectedly accepted invalid timestamp");
}
const invalid: unknown[] = [
  -1,
  0.5,
  NaN,
  Infinity,
  -Infinity,
  Number.MAX_SAFE_INTEGER + 1,
  "0",
  null,
  undefined,
  {},
  [],
  0n,
];
test("shared timestamp seam preserves its default error and supports the exact Store error", () => {
  for (const value of invalid) {
    expect(message(() => timestamp(value))).toBe(
      "invalid cooldown timing timestamp",
    );
    expect(message(() => timestamp(value, "invalid cooldown timestamp"))).toBe(
      "invalid cooldown timestamp",
    );
  }
  for (const value of [0, 1, Number.MAX_SAFE_INTEGER]) {
    expect(() => timestamp(value)).not.toThrow();
    expect(() => timestamp(value, "invalid cooldown timestamp")).not.toThrow();
  }
});
test("Store invalid defer input and persisted gate preserve exact errors without mutation", () => {
  const store = new Store(":memory:");
  try {
    const snapshot = () =>
      JSON.stringify([
        store.db.query("SELECT * FROM cooldown").all(),
        store.db.query("SELECT * FROM timing_events").all(),
      ]);
    const before = snapshot();
    for (const value of invalid)
      expect(message(() => store.defer(value as number))).toBe(
        "invalid cooldown timestamp",
      );
    expect(snapshot()).toBe(before);
    for (const value of [-1, 0.5, "broken"]) {
      store.db.query("UPDATE cooldown SET not_before=?").run(value);
      const prior = snapshot();
      expect(message(() => store.notBefore())).toBe(
        "invalid cooldown timestamp",
      );
      expect(snapshot()).toBe(prior);
    }
  } finally {
    store.close();
  }
});
