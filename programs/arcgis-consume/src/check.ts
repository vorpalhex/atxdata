export function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function object(value: unknown): Record<string, unknown> {
  ensure(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "expected JSON object",
  );
  const result = value as Record<string, unknown>;
  ensure(!("error" in result), "ArcGIS JSON error");
  return result;
}
export function array(value: unknown): unknown[] {
  ensure(Array.isArray(value), "expected array");
  return value;
}
export function finite(value: unknown): number {
  ensure(
    typeof value === "number" && Number.isFinite(value),
    "expected finite number",
  );
  return value;
}
export function integer(value: unknown, min: number, max: number): number {
  const n = finite(value);
  ensure(
    Number.isSafeInteger(n) && n >= min && n <= max,
    "integer outside bounds",
  );
  return n;
}
export function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
