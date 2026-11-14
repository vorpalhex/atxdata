import type { Evidence } from "./adapters";
import { Engine, type Listed } from "./engine";
import { sha, selectedIdentity } from "./engine";
import { archiveVersion, readCooldown } from "./schema";
import { requireProducing, producingReference } from "./producing-integrity";
import { requirePdf } from "./pdf";
import { workBudget, type WorkBudget } from "./budgets";
import { cityPublication, requireCityEvidence } from "./city-publications";
import { inspectOriginal } from "./pdf";
import { join } from "node:path";
export type CaptureRequest = {
  source: string;
  observation: string;
  captureAttempt: string;
  documentSha256: string;
  selectionSha256: string;
  bodyPolicy: string;
};
function requireCapture(ok: boolean, message: string): void {
  if (!ok) throw Error("capture revalidation " + message);
}
export function captureSelectionHash(row: Evidence): string {
  return sha(JSON.stringify(selectedIdentity(row)));
}
export function validateCaptureRequest(request: CaptureRequest): void {
  requireOriginalPolicy(request.source, request.bodyPolicy);
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  requireCapture(
    [uuid.test(request.observation), uuid.test(request.captureAttempt)].every(
      Boolean,
    ),
    "requires exact observation/attempt UUIDs",
  );
  requireCapture(
    [request.documentSha256, request.selectionSha256].every((value) =>
      /^[a-f0-9]{64}$/.test(value),
    ),
    "requires exact document/selection SHA256",
  );
}
export function requireCaptureWritable(engine: Engine): void {
  const gate = readCooldown(engine.db);
  requireCapture(
    [!gate.blocked, gate.not_before <= Date.now()].every(Boolean),
    "held root; no offline mutation authorized",
  );
}
export function requireNewCapture(engine: Engine, row: Listed): void {
  const existing = engine.db
    .query(
      "SELECT 1 FROM versions WHERE source=? AND url=? UNION ALL SELECT 1 FROM validation_history WHERE source=? AND url=? UNION ALL SELECT 1 FROM history WHERE source=? AND url=? LIMIT 1",
    )
    .get(row.source, row.url, row.source, row.url, row.source, row.url);
  requireCapture(!existing, "existing version/history; strictly new only");
  const receipt = engine.db
    .query("SELECT 1 FROM history_receipts WHERE observation=? LIMIT 1")
    .get(row.id);
  requireCapture(!receipt, "existing observation receipt; strictly new only");
}
function captureClock(kind: string, started: number, ended: number) {
  requireCapture(
    kind.startsWith("transport-work-v1:"),
    "missing original producing clock receipt",
  );
  const receipt = JSON.parse(kind.slice("transport-work-v1:".length)),
    headersObserved = receipt.headerTiming?.observed;
  requireCapture(
    [
      [started, ended, headersObserved].every(Number.isSafeInteger),
      started <= headersObserved,
      headersObserved <= ended,
    ].every(Boolean),
    "original producing clock mismatch",
  );
  return { started, headersObserved, ended };
}
export function captureBinding(
  engine: Engine,
  request: CaptureRequest,
  limits: WorkBudget,
) {
  validateCaptureRequest(request);
  requireCapture(archiveVersion(engine.db) === 5, "requires physical archive5");
  const row = engine.observation(request.observation);
  requireCapture(
    [
      row.source === request.source,
      captureSelectionHash(row) === request.selectionSha256,
    ].every(Boolean),
    "selected source/selection hash mismatch",
  );
  const snapshot = engine.db
    .query<any, [string]>(
      "SELECT s.id,s.url,s.sha,s.observed,s.origin,m.adapter_schema,p.attempt FROM observations o JOIN snapshots s ON s.id=o.snapshot JOIN snapshot_metadata m ON m.snapshot=s.id JOIN snapshot_producers p ON p.snapshot=s.id WHERE o.id=?",
    )
    .get(row.id);
  requireCapture(Boolean(snapshot), "missing metadata snapshot");
  requireCapture(
    [
      snapshot?.adapter_schema === 6 ||
        (snapshot?.adapter_schema === 7 &&
          row.source === "austin-council-archives"),
      snapshot.url === row.pageUrl,
      snapshot.origin === "live-http",
      Boolean(snapshot.attempt),
    ].every(Boolean),
    "current City complete HTTP snapshot required",
  );
  const a = engine.db
    .query<any, [string]>(
      "SELECT a.*,r.kind producing_kind,r.source producing_source,r.status run_status,r.error run_error,p.* FROM attempts a JOIN runs r ON r.id=a.run JOIN representations p ON p.attempt=a.id WHERE a.id=?",
    )
    .get(request.captureAttempt);
  requireCapture(Boolean(a), "missing complete attempt/representation");
  requireCapture(
    [
      a.kind === "pdf",
      a.status === 200,
      a.error === null,
      a.ended !== null,
      a.run_status === "complete",
      a.run_error === null,
      a.producing_source === row.source,
      a.url === row.url,
    ].every(Boolean),
    "incomplete/foreign producing attempt",
  );
  requireCapture(
    [
      a.representation === "encoded-and-decoded",
      Boolean(a.wire_path),
      a.encoded_hash !== null,
      a.wire_bytes !== null,
      a.decoded_hash === request.documentSha256,
    ].every(Boolean),
    "complete decoded document identity required",
  );
  requireCapture(
    a.decoded_bytes <=
      Math.min(engine.maxPdfBytes, limits.maxPdfBytes, limits.maxBytes),
    "current PDF/aggregate byte budget exceeded",
  );
  requireProducing(
    engine.db,
    {
      source: row.source,
      url: row.url,
      sha: request.documentSha256,
      headers: a.headers,
    },
    producingReference("live-http", request.captureAttempt),
    "pdf",
  );
  const pageAttempt = engine.db
    .query<any, [string]>("SELECT ended FROM attempts WHERE id=?")
    .get(snapshot.attempt);
  requireCapture(
    [
      pageAttempt?.ended !== null,
      pageAttempt?.ended <= a.started,
      Date.parse(snapshot.observed) <= a.started,
    ].every(Boolean),
    "chronologically incompatible source snapshot",
  );
  const clock = captureClock(a.producing_kind, a.started, a.ended);
  return { row, attempt: a, snapshot, clock };
}
export async function prepareCapture(
  engine: Engine,
  request: CaptureRequest,
  options: Partial<WorkBudget> = {},
) {
  const limits = workBudget(options);
  requireCaptureWritable(engine);
  const binding = captureBinding(engine, request, limits);
  requireNewCapture(engine, binding.row);
  requireCapture(
    ["pending", "failed"].includes(binding.row.status),
    "requires an unaccepted original capture",
  );
  await engine.preflight();
  const bytes = await engine.readArtifact(binding.attempt.decoded_path);
  requireCapture(
    [
      sha(bytes) === request.documentSha256,
      bytes.length === binding.attempt.decoded_bytes,
    ].every(Boolean),
    "retained decoded body identity mismatch",
  );
  const mime =
    new Headers(JSON.parse(binding.attempt.headers)).get("content-type") ?? "";
  requirePdf(bytes, mime, Math.min(engine.maxPdfBytes, limits.maxPdfBytes));
  requireCityEvidence(binding.row);
  const derived = {
    parsed: await inspectOriginal(
      join(engine.root, binding.attempt.decoded_path),
    ),
  };
  requireCapture(
    bytes.length + Buffer.byteLength(derived.parsed.info) <= limits.maxBytes,
    "current aggregate original/metadata byte budget exceeded",
  );
  await engine.preflight();
  requireCaptureWritable(engine);
  const final = captureBinding(engine, request, limits);
  requireNewCapture(engine, final.row);
  requireCapture(
    JSON.stringify(final) === JSON.stringify(binding),
    "capture changed during awaited derivation",
  );
  return { request, limits, binding, bytes, mime, derived };
}
export const ORIGINAL_POLICY = "publisher-linked-original-v1";
export const ORIGINAL_QUALITY = "original-integrity-only";
export function requireOriginalPolicy(source: string, policy: string): void {
  if (!cityPublication(source) || policy !== ORIGINAL_POLICY)
    throw Error(
      "original retention requires explicit City publisher-linked-original policy",
    );
}
export function requireOriginalReceipt(row: Evidence, receipt: any): void {
  requireOriginalPolicy(row.source, receipt.identityPolicy);
  requireCapture(
    [
      receipt.schema === 9,
      receipt.quality === ORIGINAL_QUALITY,
      receipt.semanticIdentityValidated === false,
      receipt.structuredInterpretation === false,
    ].every(Boolean),
    "receipt9 original-only guarantees mismatch",
  );
}

type Prepared = Awaited<ReturnType<typeof prepareCapture>>;
function structuralFacts(
  parsed: { info: string; pages: number },
  mime: string,
  bytes: number,
) {
  return {
    mime,
    magic: "%PDF-",
    bytes,
    pages: parsed.pages,
    pdfVersion: /^PDF version:\s+(.+)$/m.exec(parsed.info)?.[1] ?? null,
    encrypted: /^Encrypted:\s+(.+)$/m.exec(parsed.info)?.[1] ?? null,
    javascript: /^JavaScript:\s+(.+)$/m.exec(parsed.info)?.[1] ?? null,
  };
}
export async function commitCapture(engine: Engine, prepared: Prepared) {
  const admission = () => {
    requireCaptureWritable(engine);
    requireNewCapture(engine, prepared.binding.row);
    requireCapture(
      JSON.stringify(
        captureBinding(engine, prepared.request, prepared.limits),
      ) === JSON.stringify(prepared.binding),
      "capture changed at artifact boundary",
    );
  };
  admission();
  const pdf = await engine.artifact(prepared.bytes, "pdf", admission),
    info = await engine.artifact(
      Buffer.from(prepared.derived.parsed.info),
      "txt",
      admission,
    );
  return engine.db.transaction(() => {
    admission();
    const { binding, request, bytes, mime, derived } = prepared,
      run = engine.start(binding.row.source, "offline-retain-original"),
      decidedAt = new Date().toISOString();
    const receipt = {
      schema: 9,
      identityPolicy: ORIGINAL_POLICY,
      parser: "Poppler",
      quality: ORIGINAL_QUALITY,
      semanticIdentityValidated: false,
      structuredInterpretation: false,
      documentSha256: sha(bytes),
      selection: selectedIdentity(binding.row),
      info: derived.parsed.info,
      pages: derived.parsed.pages,
      structure: structuralFacts(derived.parsed, mime, bytes.length),
      headers: binding.attempt.headers,
      originalRetrievedAt: null,
      producing: producingReference("live-http", request.captureAttempt),
      derivations: {
        pdfInfo: { path: info.path, sha256: sha(derived.parsed.info) },
      },
      retention: {
        schema: 1,
        run,
        decidedAt,
        captureAttempt: request.captureAttempt,
        observation: binding.row.id,
        expectedDocumentSha256: request.documentSha256,
        expectedSelectionSha256: request.selectionSha256,
        originalProducingClock: binding.clock,
        snapshot: {
          id: binding.snapshot.id,
          sha256: binding.snapshot.sha,
          producerAttempt: binding.snapshot.attempt,
        },
        binding: "current-explicit-observation-to-complete-capture",
      },
    };
    requireCapture(
      Date.parse(decidedAt) >= binding.clock.ended,
      "decision precedes original capture",
    );
    const value = JSON.stringify(receipt),
      hash = sha(value),
      row = binding.row;
    engine.db.run("INSERT INTO versions VALUES(?,?,?,?,?,?,?)", [
      row.source,
      row.url,
      pdf.hash,
      bytes.length,
      pdf.path,
      mime,
      value,
    ]);
    engine.db.run("INSERT INTO validation_history VALUES(?,?,?,?,?,?)", [
      row.source,
      row.url,
      pdf.hash,
      hash,
      value,
      decidedAt,
    ]);
    engine.db.run("INSERT INTO history VALUES(?,?,?,?,?,?)", [
      row.id,
      row.source,
      row.url,
      pdf.hash,
      "live-http",
      decidedAt,
    ]);
    engine.db.run("INSERT INTO history_receipts VALUES(?,?,?)", [
      row.id,
      pdf.hash,
      hash,
    ]);
    engine.db.run("UPDATE observations SET status='downloaded' WHERE id=?", [
      row.id,
    ]);
    engine.finish(run);
    return {
      hash: pdf.hash,
      path: pdf.path,
      observation: row.id,
      sha256: pdf.hash,
      receiptSchema: 9,
      quality: ORIGINAL_QUALITY,
      semanticIdentityValidated: false,
      structuredInterpretation: false,
      decisionRun: run,
      httpRequests: 0,
    };
  })();
}
export async function verifyCaptureReceipt(
  engine: Engine,
  row: Listed,
  receipt: any,
  path: string,
  parsed: { info: string; pages: number },
  bytes: Uint8Array,
  mime: string,
) {
  requireOriginalReceipt(row, receipt);
  const event = receipt.retention;
  requireCapture(event?.schema === 1, "missing retention event");
  const request: CaptureRequest = {
    source: row.source,
    observation: row.id,
    captureAttempt: event.captureAttempt,
    documentSha256: event.expectedDocumentSha256,
    selectionSha256: event.expectedSelectionSha256,
    bodyPolicy: ORIGINAL_POLICY,
  };
  const binding = captureBinding(
    engine,
    request,
    workBudget({ maxPdfBytes: engine.maxPdfBytes }),
  );
  requireCapture(
    [
      receipt.documentSha256 === sha(bytes),
      JSON.stringify(receipt.selection) ===
        JSON.stringify(selectedIdentity(row)),
      receipt.parser === "Poppler",
      receipt.info === parsed.info,
      receipt.pages === parsed.pages,
      JSON.stringify(receipt.structure) ===
        JSON.stringify(structuralFacts(parsed, mime, bytes.length)),
      receipt.headers === binding.attempt.headers,
      receipt.producing?.origin === "live-http",
      receipt.producing?.attempt === request.captureAttempt,
      event.observation === row.id,
      event.expectedDocumentSha256 === receipt.documentSha256,
      JSON.stringify(event.originalProducingClock) ===
        JSON.stringify(binding.clock),
      JSON.stringify(event.snapshot) ===
        JSON.stringify({
          id: binding.snapshot.id,
          sha256: binding.snapshot.sha,
          producerAttempt: binding.snapshot.attempt,
        }),
      event.binding === "current-explicit-observation-to-complete-capture",
    ].every(Boolean),
    "original receipt source/structure/producer mismatch",
  );
  const run = engine.db
      .query<any, [string]>("SELECT * FROM runs WHERE id=?")
      .get(event.run),
    at = Date.parse(event.decidedAt);
  requireCapture(Boolean(run), "missing retention decision run");
  requireCapture(
    [
      run.kind === "offline-retain-original",
      run.source === row.source,
      run.status === "complete",
      run.error === null,
      Number.isFinite(at),
      at >= binding.clock.ended,
      at >= Date.parse(run.started),
      at <= Date.parse(run.finished),
    ].every(Boolean),
    "retention decision clock/run mismatch",
  );
  requireCapture(
    Boolean(receipt.derivations?.pdfInfo?.path),
    "missing pdfinfo derivation",
  );
  const info = await engine.readArtifact(receipt.derivations.pdfInfo.path);
  requireCapture(
    [
      sha(info) === receipt.derivations.pdfInfo.sha256,
      info.toString() === parsed.info,
    ].every(Boolean),
    "original pdfinfo derivation mismatch",
  );
}
export async function admitOriginal(
  root: string,
  request: CaptureRequest,
  options: Partial<WorkBudget> = {},
) {
  validateCaptureRequest(request);
  const engine = await Engine.openReadOnly(root, {
    maxPdfBytes: workBudget(options).maxPdfBytes,
  });
  try {
    await prepareCapture(engine, request, options);
  } finally {
    await engine.close();
  }
}

export async function admitOriginalCollection(
  root: string,
  source: import("./adapters").Source,
  scope: import("./adapters").Selection,
  limits: WorkBudget,
) {
  requireOriginalPolicy(source, ORIGINAL_POLICY);
  const e = await Engine.openReadOnly(root, {
    maxPdfBytes: limits.maxPdfBytes,
  });
  try {
    await e.preflight();
    const rows = e.list(source, scope);
    requireCapture(rows.length > 0, "no selected observations");
    for (const row of rows) {
      if (row.status === "captured")
        await e.verify(source, { ...scope, url: row.url, limit: 1 });
      else {
        requireCapture(!readCooldown(e.db).blocked, "held root");
        requireNewCapture(e, row);
        requireCityEvidence(row);
      }
    }
  } finally {
    await e.close();
  }
}
