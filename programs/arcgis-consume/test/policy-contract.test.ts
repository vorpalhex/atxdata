import { test, expect } from "bun:test";
import {
  validatePolicyOptions,
  policyFlags,
} from "../src/policy-inspection-contract";
const valid = {
  item: "d".repeat(32),
  appRun: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  appItemSha256: "b".repeat(64),
  budget: {
    requests: 2,
    totalBytes: 2000000,
    responseBytes: 1000000,
    zipBytes: 1000000,
    retries: 0,
  },
};
test("policy exact finite contract rejects widened budgets and malformed identities", () => {
  expect(validatePolicyOptions(valid)).toEqual(valid);
  for (const key of Object.keys(valid.budget)) {
    const incomplete: Record<string, number> = { ...valid.budget };
    delete incomplete[key];
    expect(() =>
      validatePolicyOptions({ ...valid, budget: incomplete }),
    ).toThrow();
  }
  for (const key of ["item", "appRun", "appItemSha256"])
    for (const value of ["", null, "bad"])
      expect(() => validatePolicyOptions({ ...valid, [key]: value })).toThrow();
  for (const key of ["requests", "totalBytes", "responseBytes", "zipBytes"])
    for (const value of [0, -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER])
      expect(() =>
        validatePolicyOptions({
          ...valid,
          budget: { ...valid.budget, [key]: value },
        }),
      ).toThrow();
  expect(() =>
    validatePolicyOptions({
      ...valid,
      budget: { ...valid.budget, retries: 1 },
    }),
  ).toThrow();
  expect(() => validatePolicyOptions({ ...valid, permission: true })).toThrow();
});
test("policy flag defaults, exact values and command binding", () => {
  const f = {
    "--item": valid.item,
    "--app-run": valid.appRun,
    "--app-item-sha256": valid.appItemSha256,
  };
  expect(policyFlags("inspect-policy", "austin", f)).toEqual(valid);
  expect(policyFlags("verify", undefined, {})).toBeUndefined();
  expect(() => policyFlags("verify", undefined, f)).toThrow();
  expect(() => policyFlags("inspect-policy", "water", f)).toThrow();
  expect(() =>
    policyFlags("inspect-policy", "austin", { ...f, "--max-requests": "1x" }),
  ).toThrow();
  expect(
    policyFlags("inspect-policy", "austin", { ...f, "--max-requests": "1" })!
      .budget.requests,
  ).toBe(1);
});
