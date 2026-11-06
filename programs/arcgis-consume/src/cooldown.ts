import { ensure } from "./check";
function seconds(raw: string | null): number {
  ensure(
    raw !== null && /^\d+(?:\.\d+)?$/.test(raw),
    "uninterpretable cooldown",
  );
  const n = Number(raw) * 1000;
  ensure(Number.isFinite(n), "uninterpretable cooldown");
  return n;
}
function retryAfter(headers: Headers, now: number): number {
  const raw = headers.get("retry-after");
  if (raw === null) return now;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return now + seconds(raw);
  const date = Date.parse(raw),
    server = headers.get("date");
  ensure(Number.isFinite(date), "uninterpretable cooldown Retry-After");
  const base = server === null ? now : Date.parse(server);
  ensure(Number.isFinite(base), "uninterpretable cooldown Date");
  return now + Math.max(0, date - base);
}
function reset(headers: Headers, prefix: string, now: number): number {
  const remaining = headers.get(`${prefix}ratelimit-remaining`);
  if (remaining === null) return now;
  ensure(
    /^\d+$/.test(remaining.trim()),
    "uninterpretable cooldown remaining quota",
  );
  if (Number(remaining) !== 0) return now;
  const delay = seconds(headers.get(`${prefix}ratelimit-reset`));
  return prefix ? Math.max(now, delay) : now + delay;
}
function structured(raw: string | null, now: number): number {
  if (raw === null) return now;
  let end = now;
  for (const policy of raw.split(",")) {
    const remaining = /(?:^|;)\s*r\s*=\s*(\d+)(?:;|$)/.exec(policy);
    ensure(remaining, "uninterpretable cooldown RateLimit");
    if (remaining[1] === "0") {
      const t = /(?:^|;)\s*t\s*=\s*(\d+(?:\.\d+)?)(?:;|$)/.exec(policy);
      ensure(t, "uninterpretable cooldown RateLimit reset");
      end = Math.max(end, now + seconds(t[1]));
    }
  }
  return end;
}
export function cooldown(headers: Headers, now: number): number {
  return Math.max(
    now,
    retryAfter(headers, now),
    reset(headers, "", now),
    reset(headers, "x-", now),
    structured(headers.get("ratelimit"), now),
  );
}
