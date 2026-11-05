import { parse } from "csv-parse/sync";
export const HEADER = [
  "Fiscal Year",
  "Payment Date",
  "Payment #",
  "Vendor Number & Name",
  "Invoice #",
  "Amount",
  "Purchainging Order #",
  "Department",
  "Fund",
  "Expenditure Category",
  "Acct LineItem",
  "Description",
  "EncashmentDate",
];
export interface Row {
  ordinal: number;
  fields: string[];
  cents: string | null;
  reason: string | null;
}
function validDate(value: string): boolean {
  let normalized = value;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (slash)
    normalized = `${slash[3]}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(normalized) &&
    !isNaN(Date.parse(normalized)) &&
    new Date(normalized).toISOString().slice(0, 10) === normalized
  );
}
function reason(fields: string[], year: number): string | null {
  if (fields.length !== 13) return "row_width";
  if (!/^-?\d+(\.\d{1,2})?$/.test(fields[5])) return "bad_money";
  if (!validDate(fields[1]) || (fields[12] !== "" && !validDate(fields[12])))
    return "bad_date";
  if (fields[0] !== String(year)) return "year_mismatch";
  return null;
}
function cents(value: string): string {
  const negative = value.startsWith("-");
  const [whole, frac = ""] = value.replace(/^-/, "").split(".");
  return String(
    (BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0"))) *
      (negative ? -1n : 1n),
  );
}
export function decode(bytes: Buffer, year: number): Row[] {
  const records = parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    { relax_column_count: true },
  ) as string[][];
  if (JSON.stringify(records[0]) !== JSON.stringify(HEADER))
    throw new Error("schema_mismatch");
  return records.slice(1).map((fields, i) => {
    const rejected = reason(fields, year);
    return {
      ordinal: i + 1,
      fields,
      cents: rejected ? null : cents(fields[5]),
      reason: rejected,
    };
  });
}
