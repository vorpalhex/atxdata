import type { Engine } from "./engine";
type Original = {
  id: string;
  run_id: string;
  source: string;
  url: string;
  kind: string;
  status: number;
  headers: string;
  ended: number | null;
  error: string | null;
};
type Downstream = {
  source: string;
  url: string;
  kind: string;
  started: number;
};
type PolicyBinding = {
  redirect_attempt: string;
  final_attempt: string;
  url: string;
  kind: string;
  status: number;
  headers: string;
  decoded_hash: string;
  ended: number | null;
  error: string | null;
};
export type Edge = {
  attempt: string;
  target_url: string;
  target_attempt: string | null;
};
function requireRedirect(checks: boolean[], message: string): void {
  if (!checks.every(Boolean)) throw Error(message);
}
function safeTarget(from: string, location: string): URL {
  const target = new URL(location, from);
  requireRedirect(
    [
      target.protocol === "https:",
      !target.username,
      !target.password,
      !target.port,
      !target.hash,
      !target.search,
    ],
    "unsafe redirect target",
  );
  return target;
}
function robotsRoute(from: string, target: URL, kind: string): boolean {
  return (
    kind === "robots" &&
    from === "https://services.austintexas.gov/robots.txt" &&
    target.href === "https://www.austintexas.gov/robots.txt"
  );
}
function councilRoute(from: string, target: URL, kind: string): void {
  const original = new URL(from);
  const council =
    /^\/council\/(?:archive\/[^/]*(?:council|index)[^/]*|\d{4}\/[^/]*index[^/]*)$/;
  const canonical =
    /^\/(?:content\/archive-council-meetings-held-\d{4}|council\/(?:archive\/[^/]*(?:council|index)[^/]*|\d{4}\/[^/]*index[^/]*))$/;
  requireRedirect(
    [
      kind === "page",
      original.origin === "https://www.austintexas.gov",
      target.origin === original.origin,
      council.test(original.pathname),
      canonical.test(target.pathname),
      original.href !== target.href,
    ],
    "unapproved redirect route",
  );
}
export function redirectTarget(
  source: string,
  from: string,
  status: number,
  location: string | null,
  kind: string,
): string {
  requireRedirect(
    [source.startsWith("austin-"), status === 302, Boolean(location)],
    "unapproved redirect",
  );
  const target = safeTarget(from, location!);
  if (!robotsRoute(from, target, kind)) councilRoute(from, target, kind);
  return target.href;
}
export function hasRedirectSchema(engine: Engine): boolean {
  return (
    engine.db
      .query<{ version: number }, []>("SELECT version FROM archive_schema")
      .get()?.version === 4
  );
}
export function redirectEdges(engine: Engine): Edge[] {
  return hasRedirectSchema(engine)
    ? engine.db.query<Edge, []>("SELECT * FROM redirect_edges").all()
    : [];
}
function originalReceipt(engine: Engine, edge: Edge): Original {
  const a = engine.db
    .query<Original, [string]>(
      "SELECT a.*,r.source,r.id run_id FROM attempts a JOIN runs r ON r.id=a.run WHERE a.id=?",
    )
    .get(edge.attempt);
  if (!a) throw Error("redirect edge original receipt missing");
  requireRedirect(
    [
      a.run_id.startsWith("transport-work-v3:"),
      a.status === 302,
      a.error === null,
      a.ended !== null,
    ],
    "redirect edge original receipt invalid",
  );
  const location = new Headers(JSON.parse(a.headers)).get("location");
  requireRedirect(
    [
      redirectTarget(a.source, a.url, a.status, location, a.kind) ===
        edge.target_url,
    ],
    "redirect edge Location mismatch",
  );
  return a;
}
function downstreamReceipt(
  engine: Engine,
  edge: Edge,
  a: Original,
  blocked: string | null,
): void {
  if (edge.target_attempt === null) {
    requireRedirect([Boolean(blocked)], "unfinished redirect without stop");
    return;
  }
  const b = engine.db
    .query<Downstream, [string]>(
      "SELECT a.*,r.source FROM attempts a JOIN runs r ON r.id=a.run WHERE a.id=?",
    )
    .get(edge.target_attempt);
  if (!b) throw Error("redirect downstream receipt missing");
  requireRedirect(
    [
      b.source === a.source,
      b.kind === a.kind,
      b.url === edge.target_url,
      b.started >= a.ended! + 3000,
    ],
    "redirect downstream identity/pacing mismatch",
  );
}
function acyclicChain(edge: Edge, byId: Map<string, Edge>): void {
  const visited = new Set<string>();
  let current: Edge | undefined = edge;
  while (current) {
    requireRedirect(
      [!visited.has(current.attempt), visited.size < 3],
      "redirect cycle/hop ceiling",
    );
    visited.add(current.attempt);
    current = current.target_attempt
      ? byId.get(current.target_attempt)
      : undefined;
  }
}
export function verifyRedirects(engine: Engine): void {
  const edges = redirectEdges(engine),
    byId = new Map(edges.map((e) => [e.attempt, e]));
  const gate = engine.db
    .query<{ blocked: string | null }, []>("SELECT blocked FROM cooldowns")
    .get()!;
  for (const edge of edges) {
    downstreamReceipt(
      engine,
      edge,
      originalReceipt(engine, edge),
      gate.blocked,
    );
    acyclicChain(edge, byId);
  }
}
function policyReceipt(engine: Engine, origin: string): PolicyBinding | null {
  return engine.db
    .query<PolicyBinding, [string]>(
      "SELECT b.*,a.url,a.kind,a.status,a.headers,a.ended,a.error,r.decoded_hash FROM robots_bindings b JOIN attempts a ON a.id=b.final_attempt JOIN representations r ON r.attempt=a.id WHERE b.origin=?",
    )
    .get(origin);
}
function requirePolicy(
  edge: Edge,
  row: PolicyBinding,
  origin: string,
  hash: string,
): void {
  requireRedirect(
    [
      origin === "https://services.austintexas.gov",
      edge.target_attempt === row.final_attempt,
      edge.target_url === "https://www.austintexas.gov/robots.txt",
      row.url === edge.target_url,
      row.kind === "robots",
      row.status === 200,
      row.error === null,
      row.ended !== null,
      row.decoded_hash === hash,
      /^text\/plain(?:;|$)/i.test(
        new Headers(JSON.parse(row.headers)).get("content-type") ?? "",
      ),
    ],
    "redirect robots policy binding invalid",
  );
}
export function boundRobots(
  engine: Engine,
  origin: string,
  hash: string,
): boolean {
  if (!hasRedirectSchema(engine)) return false;
  const row = policyReceipt(engine, origin);
  if (!row) return false;
  const edge = redirectEdges(engine).find(
    (e) => e.attempt === row.redirect_attempt,
  );
  if (!edge) throw Error("redirect robots policy edge missing");
  requirePolicy(edge, row, origin, hash);
  const original = engine.db
    .query<{ url: string }, [string]>("SELECT url FROM attempts WHERE id=?")
    .get(edge.attempt);
  requireRedirect(
    [original?.url === origin + "/robots.txt"],
    "redirect robots original origin mismatch",
  );
  return true;
}
