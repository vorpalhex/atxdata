import { expect, test } from "bun:test";
import { parsePositiveInteger } from "../../src/util/integers";

for (const value of ["", " ", " 1", "1 ", "1x", "1.5", "0", "-1", "+1", "1e2", "Infinity", "9007199254740992"]) {
  test(`positive integer parser rejects ${JSON.stringify(value)}`, () => {
    expect(() => parsePositiveInteger(value)).toThrow("Invalid positive integer");
  });
}
for (const value of ["1", "42", "9007199254740991"]) {
  test(`positive integer parser accepts ${value}`, () => {
    expect(parsePositiveInteger(value)).toBe(Number(value));
  });
}
