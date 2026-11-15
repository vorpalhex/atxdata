import { createHash } from "node:crypto";
import { object } from "./check";
export function terms(value: unknown) {
  const item = object(value);
  const text = {
    licenseInfo: item.licenseInfo ?? null,
    accessInformation: item.accessInformation ?? null,
    description: item.description ?? null,
  };
  return {
    sha256: createHash("sha256").update(JSON.stringify(text)).digest("hex"),
    ...text,
  };
}
