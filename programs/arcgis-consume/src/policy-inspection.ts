import type { Archive } from "./archive";
import type { Database } from "bun:sqlite";
import { ReadonlyAppEvidence } from "./app-readonly";
import { verifyAppRuns } from "./app-metadata";
import { withReadOnlyArchive } from "./app-preopen";
import { validateTiming } from "./timing";
import { ensure, same } from "./check";
import {
  policyMode,
  policyKind,
  mapsPolicy,
  hubTarget,
  validatePolicyOptions,
  type PolicyOptions,
} from "./policy-inspection-contract";
import {
  policyRuns,
  markedPolicy,
  sourceBinding,
  verifyPolicyRuns,
  policySummary,
  hop,
  classify,
} from "./policy-inspection-receipt";
export async function readOnlyPolicyPreflight(
  root: string,
  options?: PolicyOptions,
) {
  await withReadOnlyArchive(
    root,
    async (db) => {
      if (!options && !policyRuns(db).some((r) => markedPolicy(db, r))) return;
      const gates = db
        .query<{ id: number; not_before: number }, []>("SELECT * FROM cooldown")
        .all();
      ensure(
        gates.length === 1 &&
          gates[0]!.id === 1 &&
          Number.isSafeInteger(gates[0]!.not_before) &&
          gates[0]!.not_before < Number.MAX_SAFE_INTEGER,
        "policy inspection cooldown requires review",
      );
      validateTiming(db, gates[0]!.not_before, new Set());
      const closure = await verifySourceClosure(root, db, options);
      closure.evidence.assertCurrent();
    },
    Boolean(options),
  );
}
async function verifySourceClosure(
  root: string,
  db: Database,
  options?: PolicyOptions,
) {
  const evidence = new ReadonlyAppEvidence(root, db);
  await verifyAppRuns(evidence);
  await verifyPolicyRuns(db, root);
  const binding = options
    ? await sourceBinding(db, root, validatePolicyOptions(options))
    : undefined;
  evidence.assertCurrent();
  return { evidence, binding };
}
export async function inspectPolicy(a: Archive, options: PolicyOptions) {
  validatePolicyOptions(options);
  a.store.preflight();
  const closure = await verifySourceClosure(a.root, a.store.db, options);
  closure.evidence.assertCurrent();
  a.store.preflight();
  const binding = closure.binding,
    key = `austin:${options.item}:${policyMode}`;
  const saved = {
    mode: policyMode,
    policyReceiptVersion: 1,
    wireKind: policyKind,
    source: "austin",
    selection: options,
    binding,
    budget: options.budget,
  };
  const prior = policyRuns(a.store.db).find(
    (r) => r.source === key && r.command === "inspect-policy",
  );
  if (prior) {
    ensure(
      same(JSON.parse(prior.options!), saved),
      "policy inspection immutable selection changed",
    );
    const summary = await policySummary(a.store.db, a.root, prior);
    closure.evidence.assertCurrent();
    a.store.preflight();
    return {
      run: prior.id,
      reused: true,
      summary,
    };
  }
  a.store.source(key, "Austin wrapper policy inspection", mapsPolicy);
  const run = a.store.start(key, "inspect-policy");
  a.store.saveOptions(run, saved);
  a.setSpacing(3000);
  a.guard = (url) =>
    ensure(
      url === mapsPolicy || url === hubTarget,
      "policy inspection authority/path refused",
    );
  await a.request(run, "policy-hop-0", mapsPolicy, policyKind);
  const first = await hop(
    a.store.db,
    a.root,
    run,
    0,
    mapsPolicy,
    options.budget.responseBytes,
  );
  if (classify(first, 0) === "redirect")
    await a.request(run, "policy-hop-1", hubTarget, policyKind);
  const r = policyRuns(a.store.db).find((r) => r.id === run)!;
  const summary = await policySummary(a.store.db, a.root, r);
  a.store.finish(run, "succeeded", undefined, summary);
  return { run, reused: false, summary };
}
