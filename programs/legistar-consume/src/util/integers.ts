export function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer: ${value}`);
  }
  return parsed;
}
