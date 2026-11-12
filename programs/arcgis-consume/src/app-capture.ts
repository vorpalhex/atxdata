import type { AppEvidence } from "./app-readonly";
function failedWire(
  fresh: {
    status: number | null;
    finished: string | null;
    error: string | null;
  },
  error: unknown,
) {
  return (
    fresh.status === 200 &&
    fresh.finished !== null &&
    error instanceof Error &&
    fresh.error === error.message
  );
}
function newUnknownTransfer(
  a: AppEvidence,
  run: string,
  label: string,
  before: Set<string>,
  cached: unknown,
  error: unknown,
) {
  const fresh = a.store.db
    .query<
      {
        id: string;
        status: number | null;
        error: string | null;
        finished: string | null;
      },
      [string, string]
    >(
      "SELECT id,status,error,finished FROM attempts WHERE run=? AND label=? ORDER BY rowid DESC LIMIT 1",
    )
    .get(run, label);
  return (
    !cached &&
    fresh !== null &&
    !before.has(fresh.id) &&
    failedWire(fresh, error) &&
    !a.store.observation(run, label)
  );
}
export async function captureText(
  a: AppEvidence,
  run: string,
  label: string,
  url: string,
  offline: boolean,
  validate: (raw: string) => void = (raw) => {
    JSON.parse(raw);
  },
) {
  if (offline) return String(await a.readExpected(run, label, url, "text"));
  a.guard?.(url);
  const cached = a.store.observation(run, label);
  const before = new Set(
    a.store.db
      .query<{ id: string }, [string, string]>(
        "SELECT id FROM attempts WHERE run=? AND label=?",
      )
      .all(run, label)
      .map((row) => row.id),
  );
  // JSON representation admits every JSON value. Only syntax runs inside wire admission.
  try {
    const raw = await a.request(run, label, url, "text", (v) => {
      validate(String(v));
    });
    return String(raw);
  } catch (error) {
    // Only a newly dispatched, settled unsuccessful metadata transfer may
    // create this hold. Cached corruption and historical parse failures cannot.
    if (newUnknownTransfer(a, run, label, before, cached, error))
      a.store.defer(Number.MAX_SAFE_INTEGER);
    throw error;
  }
}

export async function json(
  a: AppEvidence,
  run: string,
  label: string,
  url: string,
  offline: boolean,
) {
  return JSON.parse(await captureText(a, run, label, url, offline));
}
