export const sourceURL = "https://financialtransparency.traviscountytx.gov/VPR";
export interface Options {
  file: string;
  output: string;
  fiscalYear: number;
  maxBytes?: number;
  maxRows?: number;
}
export interface Batch {
  fileSHA256: string;
  fiscalYear: number;
  importedAt: string;
  bytes: number;
  status: string;
  rowsRead: number;
  accepted: number;
  rejected: number;
  sourceURL: string;
}
export function positiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error("invalid_integer");
  return value;
}
