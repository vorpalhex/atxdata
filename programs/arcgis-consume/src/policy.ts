import { ensure, object } from "./check";

export const budgetKeys = [
  "requests",
  "totalBytes",
  "responseBytes",
  "zipBytes",
  "retries",
] as const;
function budgetNumber(key: string, value: unknown) {
  ensure(
    typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= (key === "retries" ? 0 : 1),
    "invalid budget " + key,
  );
}
export function validateBudget(value: unknown, complete = false) {
  const budget = object(value);
  ensure(
    Object.keys(budget).every(
      (k) => k === "records" || (budgetKeys as readonly string[]).includes(k),
    ),
    "unknown budget key",
  );
  for (const key of budgetKeys) {
    if (!complete && !Object.hasOwn(budget, key)) continue;
    budgetNumber(key, budget[key]);
  }
  if (Object.hasOwn(budget, "records")) budgetNumber("records", budget.records);
  return budget;
}
export function validateRunOptions(value: unknown) {
  const options = object(value);
  if (Object.hasOwn(options, "budget")) validateBudget(options.budget);
  return options;
}
