import { same } from "./check";

/** Legacy policy annotations are data, not acquisition or replay requirements.
 * Ignore only their known envelope fields; retain all source/body/budget checks.
 */
function withoutPolicyAnnotations(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { waiver, sourcePolicy, acknowledgeMapsRobotsOmission, ...rest } =
    value as Record<string, unknown>;
  if (rest.selection) rest.selection = withoutPolicyAnnotations(rest.selection);
  return rest;
}
export function sameAcquisition(a: unknown, b: unknown) {
  return same(withoutPolicyAnnotations(a), withoutPolicyAnnotations(b));
}
