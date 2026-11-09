import type { Database } from "bun:sqlite";
import { ensure } from "./check";
function object(value: unknown): Record<string, any> {
  ensure(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "invalid timing object",
  );
  return value as Record<string, any>;
}
import { cooldown } from "./cooldown";

// Provider-owned append-only facts. These are independent of the mutable gate.
export const timingSchema =
  "CREATE TABLE timing_events(id TEXT PRIMARY KEY,phase TEXT NOT NULL,attempt TEXT,domain TEXT NOT NULL,clock_ms INTEGER NOT NULL,wall_ms INTEGER NOT NULL,until_ms INTEGER NOT NULL,detail TEXT NOT NULL)";
export type TimingEvent = {
  id: string;
  phase: string;
  attempt: string | null;
  domain: string;
  clock_ms: number;
  wall_ms: number;
  until_ms: number;
  detail: string;
};
export type AttemptTiming = {
  reserve?: TimingEvent;
  dispatch?: TimingEvent;
  headers?: TimingEvent;
  complete?: TimingEvent;
};
export function timestamp(
  value: unknown,
  message = "invalid cooldown timing timestamp",
): asserts value is number {
  ensure(
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
    message,
  );
}
export function serverObligation(headers: unknown, at: number) {
  try {
    const values = object(headers);
    ensure(
      Object.values(values).every((v) => typeof v === "string"),
      "invalid headers",
    );
    const due = Math.ceil(
      cooldown(new Headers(values as Record<string, string>), at),
    );
    timestamp(due);
    return due;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}
function detail(event: TimingEvent) {
  return object(JSON.parse(event.detail));
}
function headersEqual(a: unknown, b: unknown) {
  const sorted = (value: unknown) =>
    JSON.stringify(
      Object.entries(object(value)).sort(([a], [b]) => a.localeCompare(b)),
    );
  return sorted(a) === sorted(b);
}
function validateEvent(event: TimingEvent) {
  timestamp(event.clock_ms);
  timestamp(event.wall_ms);
  timestamp(event.until_ms);
  ensure(
    typeof event.domain === "string" && /^[A-Za-z0-9._:-]+$/.test(event.domain),
    "unknown timing clock domain",
  );
  ensure(
    [
      "defer",
      "spacing",
      "reserve",
      "dispatch",
      "headers",
      "complete",
      "checkpoint",
    ].includes(event.phase),
    "unknown timing phase",
  );
}
function reserveIdentity(
  event: TimingEvent,
  row: Record<string, any>,
  own: AttemptTiming,
) {
  const d = detail(event);
  ensure(
    !own.reserve &&
      d.run === row.run &&
      d.label === row.label &&
      d.url === row.url &&
      Date.parse(row.started) === event.wall_ms,
    "attempt identity/timing mismatch",
  );
}
function completeIdentity(
  event: TimingEvent,
  row: Record<string, any>,
  own: AttemptTiming,
) {
  const d = detail(event);
  ensure(
    !own.complete &&
      Date.parse(row.finished) === event.wall_ms &&
      d.status === row.status &&
      headersEqual(d.headers, JSON.parse(row.headers)) &&
      d.bytes === row.bytes &&
      (d.error ?? null) === row.error,
    "completion timing identity mismatch",
  );
  ensure(
    !own.headers || event.clock_ms >= own.headers.clock_ms,
    "completion timing order mismatch",
  );
}
function validateAttempt(
  event: TimingEvent,
  row: Record<string, any>,
  own: AttemptTiming,
) {
  const d = detail(event);
  if (event.phase === "reserve") {
    reserveIdentity(event, row, own);
  } else {
    ensure(
      own.reserve && event.clock_ms >= own.reserve.clock_ms,
      "attempt timing order mismatch",
    );
  }
  if (event.phase === "headers")
    ensure(
      d.status === row.status &&
        headersEqual(d.headers, JSON.parse(row.headers)),
      "response timing headers mismatch",
    );
  if (event.phase === "complete") completeIdentity(event, row, own);
}
function required(event: TimingEvent, own: AttemptTiming, spacing: number) {
  const d = detail(event);
  if (event.phase === "headers") {
    timestamp(d.requestedUntil);
    return Math.max(
      d.requestedUntil,
      serverObligation(d.headers, event.clock_ms),
    );
  }
  if (event.phase === "complete") {
    timestamp(d.requestedUntil);
    timestamp(d.spacingMs);
    ensure(d.spacingMs >= spacing, "completion spacing obligation mismatch");
    return Math.max(
      d.requestedUntil,
      event.clock_ms + d.spacingMs,
      own.headers?.until_ms ?? serverObligation(d.headers, event.clock_ms),
    );
  }
  if (event.phase === "spacing") {
    timestamp(d.spacingMs);
    return event.clock_ms + d.spacingMs;
  }
  if (event.phase === "defer") return event.until_ms;
  return 0;
}
function checkpointIdentity(event: TimingEvent, row: Record<string, any>) {
  const d = detail(event);
  ensure(
    d.run === row.run &&
      d.label === row.label &&
      d.path === row.path &&
      d.retrieved === row.retrieved,
    "checkpoint timing identity mismatch",
  );
}
function earliest(own?: AttemptTiming) {
  if (own?.headers) return own.headers.clock_ms;
  if (own?.reserve) return own.reserve.clock_ms;
  return 0;
}
export function checkpointTiming(
  event: TimingEvent,
  row: Record<string, any>,
  own?: AttemptTiming,
) {
  checkpointIdentity(event, row);
  const retrieved = Date.parse(row.retrieved);
  timestamp(retrieved);
  const lower = earliest(own);
  ensure(
    retrieved >= lower && retrieved <= event.clock_ms,
    "checkpoint timing retrieval outside independent clock bounds",
  );
  ensure(
    !own?.complete || event.clock_ms <= own.complete.clock_ms,
    "checkpoint timing exceeds completion fact",
  );
  return {
    domain: event.domain,
    retrievedMs: retrieved,
    lowerMs: lower,
    upperMs: event.clock_ms,
    wallMs: event.wall_ms,
  };
}
function readEvents(db: Database) {
  try {
    return db
      .query<TimingEvent, []>("SELECT * FROM timing_events ORDER BY rowid")
      .all();
  } catch {
    throw new Error(
      "legacy timing evidence unavailable: operator review required",
    );
  }
}
type TimingState = {
  due: number;
  spacingMs: number;
  domain?: string;
  last: number;
  attempts: Map<string, AttemptTiming>;
  checkpoints: TimingEvent[];
};
function eventReference(
  event: TimingEvent,
  state: TimingState,
  byId: Map<string, Record<string, any>>,
) {
  const own = state.attempts.get(event.attempt ?? "") ?? {};
  if (event.attempt) {
    const row = byId.get(event.attempt);
    ensure(row, "checkpoint attempt identity: orphan timing evidence");
    if (event.phase !== "checkpoint") validateAttempt(event, row, own);
  } else
    ensure(
      ["spacing", "defer", "checkpoint"].includes(event.phase),
      "missing attempt timing reference",
    );
  return own;
}
function accumulate(
  event: TimingEvent,
  state: TimingState,
  byId: Map<string, Record<string, any>>,
) {
  validateEvent(event);
  ensure(
    state.domain === undefined || state.domain === event.domain,
    "mixed timing clock domains: operator review required",
  );
  ensure(
    event.clock_ms >= state.last,
    "timing clock rollback: operator review required",
  );
  state.domain = event.domain;
  state.last = event.clock_ms;
  const own = eventReference(event, state, byId);
  if (event.phase === "dispatch")
    ensure(
      event.clock_ms >= state.due,
      "transport before retained cooldown obligation",
    );
  ensure(
    event.until_ms === required(event, own, state.spacingMs),
    "cooldown obligation evidence mismatch",
  );
  if (["spacing", "dispatch", "complete"].includes(event.phase)) {
    const n = detail(event).spacingMs;
    timestamp(n);
    state.spacingMs = Math.max(state.spacingMs, n);
  }
  if (event.phase === "checkpoint") state.checkpoints.push(event);
  else if (event.attempt) {
    (own as Record<string, TimingEvent>)[event.phase] = event;
    state.attempts.set(event.attempt, own);
  }
  state.due = Math.max(state.due, event.until_ms);
}
function finishedEvidence(
  rows: Record<string, any>[],
  attempts: Map<string, AttemptTiming>,
  active: ReadonlySet<string>,
) {
  for (const row of rows) {
    const own = attempts.get(row.id);
    ensure(
      own?.reserve,
      "legacy attempt timing unavailable: operator review required",
    );
    ensure(
      !row.finished || own.complete,
      "missing completion timing evidence: operator review required",
    );
    ensure(
      !own.dispatch || own.complete || active.has(row.id),
      "unfinished transport timing: operator review required",
    );
  }
}
function observationEvidence(db: Database, state: TimingState) {
  const observations = new Map<string, ReturnType<typeof checkpointTiming>>();
  const retained = db
    .query<Record<string, any>, []>("SELECT * FROM observations")
    .all();
  const byKey = new Map(retained.map((r) => [r.run + "\0" + r.label, r]));
  for (const event of state.checkpoints) {
    const d = detail(event),
      key = d.run + "\0" + d.label,
      row = byKey.get(key);
    ensure(
      row && !observations.has(key),
      "version history/checkpoint timing evidence missing/mismatched",
    );
    observations.set(
      key,
      checkpointTiming(event, row, state.attempts.get(event.attempt ?? "")),
    );
  }
  ensure(
    observations.size === retained.length,
    "checkpoint timing evidence unavailable: operator review required",
  );
  return observations;
}
// Read-only. Clock bounds are independent of the mutable gate; ISO run/attempt
// timestamps are wall-clock and must not be compared to another clock domain.
export function validateTiming(
  db: Database,
  gate: number,
  active: ReadonlySet<string> = new Set(),
) {
  timestamp(gate);
  const rows = db
    .query<Record<string, any>, []>("SELECT * FROM attempts")
    .all();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const state: TimingState = {
    due: 0,
    spacingMs: 0,
    last: -1,
    attempts: new Map(),
    checkpoints: [],
  };
  for (const event of readEvents(db)) accumulate(event, state, byId);
  ensure(
    gate >= state.due,
    "cooldown obligation rollback: gate contradicts retained timing evidence",
  );
  finishedEvidence(rows, state.attempts, active);
  return {
    requiredUntil: state.due,
    spacingMs: state.spacingMs,
    domain: state.domain,
    attempts: state.attempts,
    observations: observationEvidence(db, state),
    lastClock: state.last,
  };
}
