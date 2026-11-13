import { originalStatus } from "./original-records";
import {
  legacyChoice,
  legacySelection,
  requireLegacyEvidence,
  LEGACY_METADATA_RUN,
} from "./legacy-edims";
import {
  ORIGINAL_POLICY,
  ORIGINAL_QUALITY,
  prepareCapture,
  commitCapture,
  verifyCaptureReceipt,
  requireOriginalReceipt,
  requireOriginalPolicy,
  type CaptureRequest,
} from "./original-retention";
export { captureSelectionHash } from "./original-retention";
import {
  cityPublication,
  requireCityEvidence,
  citySelection,
  requireCityTextOnly,
} from "./city-publications";
import { DEFAULT_PDF_BYTES, positiveBudget } from "./budgets";
import {
  financialSelection,
  requireCurrentFinancial,
} from "./financial-period";
import {
  catalog,
  pageLinks,
  pageUrl,
  rootPage,
  type PageLink,
} from "./discovery";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { link, readFile, writeFile, unlink } from "node:fs/promises";
import { archiveLock, statFile } from "../../civicclerk-consume/src/archive";
import {
  discover,
  select,
  sources,
  type Evidence,
  type Selection,
  type Source,
} from "./adapters";
import {
  initialize,
  verifySchema,
  readCooldown,
  archiveVersion,
} from "./schema";
import {
  requireLiveFormat,
  verifyProducing,
  requireProducing,
  producingReference,
} from "./producing-integrity";
import { verifyCooldownObligations } from "./cooldown-integrity";
import { verifyTransportLedger } from "./transport-integrity";
import { hasRedirectSchema } from "./redirects";
import { requireArtifactReceipt } from "./artifact-receipts";
import { verifyArtifacts, verifyRepresentations } from "./archive-verification";
import {
  bodyEvidence,
  financialBodyEvidence,
  inspectOriginal,
  legacyBodyEvidence,
  inspectPdf,
  requirePdf,
  requireTextIdentity,
  renderIdentity,
  requireReview,
  requirePageReview,
  type PageReview,
  type RenderedReview,
} from "./pdf";
export const sha = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
export type Listed = Evidence & { id: string; status: string };
type Version = {
  source: Source;
  url: string;
  sha: string;
  bytes: number;
  path: string;
  mime: string;
  validation: string;
};
type Snapshot = {
  id: string;
  source: Source;
  url: string;
  sha: string;
  path: string;
  run: string;
};
type SnapshotMeta = {
  adapter_schema: number;
  observation_count: number;
  headers: string | null;
  headers_hash: string | null;
};
export function selectedIdentity(row: Evidence) {
  return {
    source: row.source,
    url: row.url,
    chapter: row.chapter,
    year: row.year,
    date: row.date,
    role: row.role,
    ...(Object.hasOwn(row, "fiscalPeriod") ? financialSelection(row) : {}),
    ...(cityPublication(row.source) ? citySelection(row) : {}),
    ...legacySelection(row),
  };
}
function knownReceiptSchema(receipt: {
  schema: number;
  identityPolicy: string;
}): boolean {
  return (
    ([2, 3, 4].includes(receipt.schema) &&
      (receipt.schema !== 4 || receipt.identityPolicy === "scoped-title-v1")) ||
    (receipt.schema === 5 &&
      receipt.identityPolicy === "austin-fiscal-title-v1") ||
    (receipt.schema === 7 &&
      receipt.identityPolicy === "austin-publication-title-date-role-v1") ||
    (receipt.schema === 6 &&
      receipt.identityPolicy === "austin-period-quarter-title-v2")
  );
}
function sourcePolicy(
  row: Evidence,
): { schema: number; identityPolicy: string } | null {
  if (cityPublication(row.source))
    return {
      schema: 7,
      identityPolicy: "austin-publication-title-date-role-v1",
    };
  if (row.source !== "austin-financial-publications") return null;
  return Object.hasOwn(row, "fiscalPeriod")
    ? { schema: 6, identityPolicy: "austin-period-quarter-title-v2" }
    : { schema: 5, identityPolicy: "austin-fiscal-title-v1" };
}
function requireSourceReceipt(
  row: Evidence,
  receipt: { schema?: number; identityPolicy?: string; quality?: string },
): void {
  if (receipt.schema === 9) {
    requireOriginalReceipt(row, receipt);
    return;
  }
  const policy = sourcePolicy(row);
  if (
    policy &&
    (receipt.schema !== policy.schema ||
      receipt.identityPolicy !== policy.identityPolicy)
  )
    throw Error("Austin PDF requires versioned city identity receipt");
  if (cityPublication(row.source) && receipt.quality !== "text-identity-only")
    throw Error("City publication requires text identity receipt7");
}
function receiptBody(text: string, schema: number) {
  if (schema === 2) return legacyBodyEvidence(text);
  return schema === 6 ? financialBodyEvidence(text) : bodyEvidence(text);
}
export class Engine {
  readonly db: Database;
  private constructor(
    readonly root: string,
    private readonly release: () => Promise<void>,
    existing: boolean,
    readonly maxPdfBytes = DEFAULT_PDF_BYTES,
    readonly readOnly = false,
  ) {
    this.db = new Database(join(root, "documents.sqlite"), {
      strict: true,
      readonly: readOnly,
    });
    try {
      if (readOnly) verifySchema(this.db);
      else initialize(this.db, existing);
      this.policyIntegrity();
      if (
        this.db
          .query(
            "SELECT 1 FROM artifact_checkpoints WHERE status='writing' LIMIT 1",
          )
          .get()
      )
        throw new Error(
          "unfinished artifact checkpoint: fail-closed manual recovery required",
        );
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  static async open(
    root: string,
    options: { maxPdfBytes?: number } = {},
  ): Promise<Engine> {
    const maxPdfBytes = positiveBudget(
      options.maxPdfBytes ?? DEFAULT_PDF_BYTES,
      "PDF byte",
    );
    const repository = resolve(import.meta.dir, "../../..");
    if (root === repository || root.startsWith(repository + "/"))
      throw new Error("runtime must stay outside checkout");
    const retained = await statFile(join(root, "documents.sqlite"));
    if (retained) {
      const reader = new Database(join(root, "documents.sqlite"), {
        readonly: true,
        strict: true,
      });
      try {
        verifySchema(reader);
        verifyProducing(reader);
      } finally {
        reader.close();
      }
    }
    const release = await archiveLock(root);
    try {
      const existing = await statFile(join(root, "documents.sqlite"));
      for (const name of ["documents.sqlite-wal", "documents.sqlite-shm"])
        await statFile(join(root, name));
      return new Engine(root, release, Boolean(existing), maxPdfBytes);
    } catch (error) {
      await release();
      throw error;
    }
  }
  static async openReadOnly(
    root: string,
    options: { maxPdfBytes?: number } = {},
  ) {
    const max = positiveBudget(
      options.maxPdfBytes ?? DEFAULT_PDF_BYTES,
      "PDF byte",
    );
    if (root !== resolve(root))
      throw Error("canonical absolute archive required");
    const repository = resolve(import.meta.dir, "../../..");
    if (root === repository || root.startsWith(repository + "/"))
      throw Error("runtime must stay outside checkout");
    if (!(await statFile(join(root, "documents.sqlite"))))
      throw Error(
        "existing archive required; retain-capture never initializes",
      );
    return new Engine(root, async () => {}, true, max, true);
  }
  async prepareCapture(
    request: CaptureRequest,
    options: Partial<import("./budgets").WorkBudget> = {},
  ) {
    return prepareCapture(this, request, options);
  }
  async retainCapture(
    request: CaptureRequest,
    options: Partial<import("./budgets").WorkBudget> = {},
  ) {
    return commitCapture(this, await prepareCapture(this, request, options));
  }
  private policyIntegrity(): void {
    verifySchema(this.db);
    verifyCooldownObligations(this, readCooldown(this.db).not_before);
  }
  async close(): Promise<void> {
    this.db.close();
    await this.release();
  }
  start(
    source: Source,
    kind: string,
    id: string = crypto.randomUUID(),
  ): string {
    if (cityPublication(source) && archiveVersion(this.db) !== 5)
      throw Error("City publications require physical archive5");
    this.policyIntegrity();
    this.db.run("INSERT OR IGNORE INTO sources VALUES(?)", [source]);
    this.db.run("INSERT INTO runs VALUES(?,?,?,?,NULL,'running',NULL)", [
      id,
      source,
      kind,
      new Date().toISOString(),
    ]);
    return id;
  }
  finish(run: string, error?: unknown): void {
    this.policyIntegrity();
    this.db.run("UPDATE runs SET finished=?,status=?,error=? WHERE id=?", [
      new Date().toISOString(),
      error ? "failed" : "complete",
      error ? String(error) : null,
      run,
    ]);
  }
  private async run<T>(
    source: Source,
    kind: string,
    action: (run: string) => Promise<T>,
  ): Promise<T> {
    const run = this.start(source, kind);
    try {
      const result = await action(run);
      this.finish(run);
      return result;
    } catch (error) {
      this.finish(run, error);
      throw error;
    }
  }
  async artifact(
    bytes: Uint8Array,
    extension: string,
    admission?: () => void,
  ): Promise<{ hash: string; path: string }> {
    if (!/^(html|pdf|candidate|wire|png|txt)$/.test(extension))
      throw new Error("unsafe artifact extension");
    const hash = sha(bytes),
      path = `${hash}.${extension}`,
      full = join(this.root, path);
    const existing = await statFile(full);
    this.policyIntegrity();
    admission?.();
    if (existing) {
      if (sha(await this.readArtifact(path)) !== hash)
        throw new Error("artifact collision/corruption");
      this.policyIntegrity();
      admission?.();
      return { hash, path };
    }
    await this.promoteArtifact(path, hash, bytes, admission);
    return { hash, path };
  }
  private async promoteArtifact(
    path: string,
    hash: string,
    bytes: Uint8Array,
    admission?: () => void,
  ): Promise<void> {
    const partial = crypto.randomUUID() + ".part";
    this.policyIntegrity();
    admission?.();
    this.db.run(
      "INSERT INTO artifact_checkpoints VALUES(?,?,?,'writing',?) ON CONFLICT(path) DO UPDATE SET status='writing',partial=excluded.partial",
      [path, hash, bytes.length, partial],
    );
    await writeFile(join(this.root, partial), bytes, {
      flag: "wx",
      mode: 0o600,
    });
    this.policyIntegrity();
    admission?.();
    await link(join(this.root, partial), join(this.root, path));
    this.policyIntegrity();
    admission?.();
    await unlink(join(this.root, partial));
    this.policyIntegrity();
    admission?.();
    this.db.run(
      "UPDATE artifact_checkpoints SET status='promoted' WHERE path=?",
      [path],
    );
  }
  private aggregate(source: Source, url: string, incoming: number): void {
    const latest = this.db
      .query<{ id: string }, [string, string]>(
        "SELECT s.id FROM snapshots s WHERE source=? AND url<>? AND rowid=(SELECT MAX(rowid) FROM snapshots newer WHERE newer.source=s.source AND newer.url=s.url)",
      )
      .all(source, url);
    let count = incoming;
    for (const snapshot of latest)
      count += this.db
        .query<{ n: number }, [string]>(
          "SELECT COUNT(*) n FROM observations WHERE snapshot=?",
        )
        .get(snapshot.id)!.n;
    if (count > 2000) throw new Error("source aggregate link ceiling");
  }
  private requireMetadataFormat(source: Source): void {
    if (cityPublication(source) && archiveVersion(this.db) !== 5)
      throw Error("City publications require physical archive5; no migration");
    if (source === "austin-financial-publications" && !hasRedirectSchema(this))
      throw Error(
        "Austin metadata requires new schema4 archive; no automatic migration",
      );
  }
  async importPage(
    source: Source,
    url: string,
    html: string,
    origin: string,
    headers: string | null = null,
    attempt?: string,
    resolveLegacyEdims = false,
  ) {
    legacyChoice(source, resolveLegacyEdims);
    this.requireMetadataFormat(source);
    const producing = producingReference(origin, attempt);
    requireLiveFormat(this.db, origin);
    requireProducing(
      this.db,
      { source, url, sha: sha(Buffer.from(html)), headers },
      producing,
      "page",
    );
    this.requireMetadataFormat(source);
    await this.preflight();
    await this.requireDiscoveryPage(source, url);
    const rows = discover(
      source,
      url,
      html,
      resolveLegacyEdims ? 7 : undefined,
    );
    this.aggregate(source, url, rows.length);
    return this.run(
      source,
      resolveLegacyEdims ? LEGACY_METADATA_RUN : "discover-import",
      async (run) => {
        const artifact = await this.artifact(Buffer.from(html), "html"),
          id = crypto.randomUUID();
        this.db.transaction(() => {
          this.policyIntegrity();
          this.db.run("INSERT INTO snapshots VALUES(?,?,?,?,?,?,?,?)", [
            id,
            source,
            url,
            artifact.hash,
            artifact.path,
            origin,
            new Date().toISOString(),
            run,
          ]);
          this.db.run("INSERT INTO snapshot_metadata VALUES(?,?,?,?,?,?)", [
            id,
            resolveLegacyEdims
              ? 7
              : cityPublication(source)
                ? 6
                : source === "austin-financial-publications"
                  ? 5
                  : 3,
            rows.length,
            headers,
            headers === null ? null : sha(headers),
            origin === "live-http" ? new Date().toISOString() : null,
          ]);
          if (archiveVersion(this.db) === 5)
            this.db.run("INSERT INTO snapshot_producers VALUES(?,?,?,?)", [
              id,
              1,
              origin,
              producing.attempt,
            ]);
          for (const evidence of rows)
            this.db.run(
              "INSERT INTO observations VALUES(?,?,?,?,?,'pending')",
              [
                crypto.randomUUID(),
                id,
                source,
                evidence.url,
                JSON.stringify(evidence),
              ],
            );
        })();
        return {
          snapshot: id,
          occurrences: rows.length,
          unique: new Set(rows.map((row) => row.url)).size,
        };
      },
    );
  }
  private redirectPages(source: Source, admitted: Set<string>): void {
    if (!cityPublication(source) || archiveVersion(this.db) !== 5) return;
    const edges = this.db
      .query<{ url: string; target_url: string }, [string]>(
        "SELECT a.url,e.target_url FROM redirect_edges e JOIN attempts a ON a.id=e.attempt JOIN runs r ON r.id=a.run WHERE r.source=? AND a.kind='page'",
      )
      .all(source);
    for (let i = 0; i < 3; i++)
      for (const edge of edges)
        if (admitted.has(edge.url)) admitted.add(edge.target_url);
  }
  async discoveryPages(source: Source): Promise<PageLink[]> {
    await this.preflight();
    const snapshots = this.db
      .query<Snapshot, [string]>(
        "SELECT * FROM snapshots WHERE source=? ORDER BY rowid",
      )
      .all(source);
    const admitted = new Set<string>(sources[source].pages),
      links = new Map<string, PageLink>();
    for (const snapshot of snapshots) {
      const bytes = await this.readArtifact(snapshot.path);
      this.redirectPages(source, admitted);
      if (sha(bytes) !== snapshot.sha || !admitted.has(snapshot.url))
        throw Error("discovery source-linked provenance mismatch");
      for (const link of pageLinks(source, snapshot.url, bytes.toString())) {
        admitted.add(link.url);
        links.set(link.url, link);
      }
    }
    return [...links.values()];
  }
  async requireDiscoveryPage(source: Source, url: string): Promise<void> {
    if (pageUrl(source, url, url) !== url)
      throw Error("noncanonical source-linked discovery URL");
    if (rootPage(source, url)) return;
    const admitted = new Set(
      (await this.discoveryPages(source)).map((link) => link.url),
    );
    this.redirectPages(source, admitted);
    if (!admitted.has(url))
      throw Error("unapproved source-linked discovery URL");
  }
  async discoveryCatalog(source: Source) {
    await this.discoveryPages(source);
    const rows = this.db
      .query<Snapshot, [string]>(
        "SELECT * FROM snapshots WHERE source=? AND rowid=(SELECT MAX(rowid) FROM snapshots newer WHERE newer.source=snapshots.source AND newer.url=snapshots.url)",
      )
      .all(source);
    const result = [];
    for (const row of rows)
      result.push({
        snapshot: row.id,
        page: row.url,
        sha256: row.sha,
        ...catalog(
          source,
          row.url,
          (await this.readArtifact(row.path)).toString(),
        ),
      });
    return result;
  }
  list(source: Source, selection: Selection): Listed[] {
    if (selection.captureOnly) requireOriginalPolicy(source, ORIGINAL_POLICY);
    const rows = this.db
      .query<{ id: string; evidence: string; status: string }, [string]>(
        "SELECT id,evidence,status FROM observations WHERE source=? ORDER BY rowid DESC",
      )
      .all(source);
    return select(
      rows
        .map((row) => ({
          ...row,
          status: originalStatus(this.db, row.id, row.status),
        }))
        .filter((row) => selection.captureOnly || row.status !== "captured")
        .map((row) => ({
          ...JSON.parse(row.evidence),
          id: row.id,
          status: row.status,
          ...(row.status === "captured"
            ? {
                quality: ORIGINAL_QUALITY,
                semanticIdentityValidated: false,
                structuredInterpretation: false,
              }
            : {}),
        })),
      selection,
    ) as Listed[];
  }
  observation(id: string): Listed {
    const row = this.db
      .query<
        { source: Source; url: string; evidence: string; status: string },
        [string]
      >("SELECT source,url,evidence,status FROM observations WHERE id=?")
      .get(id);
    if (!row) throw new Error("unknown observation");
    const evidence: Evidence = JSON.parse(row.evidence);
    if (evidence.source !== row.source || evidence.url !== row.url)
      throw new Error("observation identity mismatch");
    const metadata = this.db
      .query<{ adapter_schema: number }, [string]>(
        "SELECT m.adapter_schema FROM observations o JOIN snapshot_metadata m ON m.snapshot=o.snapshot WHERE o.id=?",
      )
      .get(id);
    if (
      metadata?.adapter_schema === 7 &&
      (!evidence.publishedHref || !evidence.endpointPolicy)
    )
      throw Error("missing metadata7 published endpoint policy");
    requireLegacyEvidence(evidence);
    return { ...evidence, id, status: originalStatus(this.db, id, row.status) };
  }
  private async parsedPdf(bytes: Uint8Array, mime: string) {
    requirePdf(bytes, mime, this.maxPdfBytes);
    const candidate = await this.artifact(bytes, "candidate");
    return inspectPdf(join(this.root, candidate.path));
  }
  private receipt(
    row: Evidence,
    bytes: Uint8Array,
    parsed: Awaited<ReturnType<typeof inspectPdf>>,
    headers: string | null,
  ) {
    return {
      schema: cityPublication(row.source)
        ? 7
        : row.source === "austin-financial-publications"
          ? 6
          : 4,
      identityPolicy: cityPublication(row.source)
        ? "austin-publication-title-date-role-v1"
        : row.source === "austin-financial-publications"
          ? "austin-period-quarter-title-v2"
          : "scoped-title-v1",
      parser: "Poppler",
      quality: "text-identity-only",
      structuredInterpretation: false,
      documentSha256: sha(bytes),
      selection: selectedIdentity(row),
      textHash: sha(parsed.text),
      info: parsed.info,
      pages: parsed.pages,
      body:
        row.source === "austin-financial-publications"
          ? financialBodyEvidence(parsed.text)
          : bodyEvidence(parsed.text),
      headers,
      originalRetrievedAt: null as string | null,
    };
  }
  async validatePdf(
    bytes: Uint8Array,
    mime: string,
    row: Evidence,
    headers: string | null = null,
  ): Promise<string> {
    requireCityEvidence(row);
    requireCurrentFinancial(row);
    const parsed = await this.parsedPdf(bytes, mime);
    requireTextIdentity(parsed.text, row);
    return JSON.stringify(this.receipt(row, bytes, parsed, headers));
  }
  private async commitPdf(
    row: Listed,
    bytes: Uint8Array,
    mime: string,
    origin: string,
    validation: string,
  ) {
    if (
      this.db
        .query<{ validation: string }, [string, string]>(
          "SELECT validation FROM versions WHERE source=? AND url=?",
        )
        .all(row.source, row.url)
        .some((v) => JSON.parse(v.validation).schema === 9)
    )
      throw Error(
        "original-only receipt cannot be overwritten by semantic import",
      );
    if (archiveVersion(this.db) === 5 && !JSON.parse(validation).producing)
      validation = JSON.stringify({
        ...JSON.parse(validation),
        producing: producingReference(origin),
      });
    const artifact = await this.artifact(bytes, "pdf"),
      receiptHash = sha(validation),
      observed = new Date().toISOString();
    this.db.transaction(() => {
      this.policyIntegrity();
      this.db.run(
        "INSERT INTO versions VALUES(?,?,?,?,?,?,?) ON CONFLICT(source,url,sha) DO UPDATE SET validation=excluded.validation",
        [
          row.source,
          row.url,
          artifact.hash,
          bytes.length,
          artifact.path,
          mime,
          validation,
        ],
      );
      this.db.run(
        "INSERT OR IGNORE INTO validation_history VALUES(?,?,?,?,?,?)",
        [row.source, row.url, artifact.hash, receiptHash, validation, observed],
      );
      this.db.run("INSERT OR IGNORE INTO history VALUES(?,?,?,?,?,?)", [
        row.id,
        row.source,
        row.url,
        artifact.hash,
        origin,
        observed,
      ]);
      this.db.run(
        "INSERT INTO history_receipts VALUES(?,?,?) ON CONFLICT(observation,sha) DO UPDATE SET receipt_hash=excluded.receipt_hash",
        [row.id, artifact.hash, receiptHash],
      );
      this.db.run("UPDATE observations SET status='downloaded' WHERE id=?", [
        row.id,
      ]);
    })();
    return artifact;
  }
  async importPdf(
    id: string,
    bytes: Uint8Array,
    mime: string,
    origin: string,
    headers: string | null = null,
    attempt?: string,
  ) {
    await this.preflight();
    const row = this.observation(id);
    if (row.status === "captured")
      throw Error(
        "original-only receipt cannot be overwritten by semantic import",
      );
    requireCityEvidence(row);
    requireCurrentFinancial(row);
    if (cityPublication(row.source) && archiveVersion(this.db) !== 5)
      throw Error("City publications require physical archive5; no migration");
    const producing = producingReference(origin, attempt);
    requireLiveFormat(this.db, origin);
    requireProducing(
      this.db,
      { source: row.source, url: row.url, sha: sha(bytes), headers },
      producing,
      "pdf",
    );
    return this.run(row.source, "collect-import", async () => {
      try {
        const original = await this.validatePdf(bytes, mime, row, headers);
        const validation =
          archiveVersion(this.db) === 5
            ? JSON.stringify({ ...JSON.parse(original), producing })
            : original;
        return await this.commitPdf(row, bytes, mime, origin, validation);
      } catch (error) {
        this.policyIntegrity();
        this.db.run("UPDATE observations SET status='failed' WHERE id=?", [id]);
        throw error;
      }
    });
  }
  async acceptRendered(
    id: string,
    bytes: Uint8Array,
    image: Uint8Array,
    review: RenderedReview,
    headers: string | null = null,
  ) {
    await this.preflight();
    const row = this.observation(id);
    requireCityTextOnly(row);
    if (row.source === "austin-financial-publications")
      throw Error(
        "Austin requires text identity; county rendered review is unsupported",
      );
    requireReview(review, row, bytes, image);
    const parsed = await this.parsedPdf(bytes, "application/pdf");
    if (parsed.pages !== 1)
      throw new Error(
        "manual rendered identity review supports one-page documents only",
      );
    const candidate = join(this.root, `${sha(bytes)}.candidate`);
    if (sha(await renderIdentity(candidate, this.root)) !== sha(image))
      throw new Error("render not bound to original PDF");
    const rendered = await this.artifact(image, "png");
    const receipt = {
      ...this.receipt(row, bytes, parsed, headers),
      quality: "image-only-visual-identity",
      imagePath: rendered.path,
      review,
    };
    receipt.body.originalAttestationDate = review.originalAttestationDate;
    receipt.body.attestationDate = review.attestationDate;
    return this.run(row.source, "collect-rendered-review", () =>
      this.commitPdf(
        row,
        bytes,
        "application/pdf",
        "explicit-private-rendered-review",
        JSON.stringify(receipt),
      ),
    );
  }
  async acceptRenderedPages(
    id: string,
    bytes: Uint8Array,
    images: Uint8Array[],
    review: PageReview,
    headers: string | null = null,
  ) {
    await this.preflight();
    const row = this.observation(id);
    requireCityTextOnly(row);
    if (row.source === "austin-financial-publications")
      throw Error(
        "Austin requires text identity; county rendered review is unsupported",
      );
    const parsed = await this.parsedPdf(bytes, "application/pdf");
    requirePageReview(review, row, bytes, images, parsed.pages);
    const candidate = join(this.root, `${sha(bytes)}.candidate`),
      imagePaths: string[] = [];
    for (const [index, entry] of review.pages.entries()) {
      if (
        sha(await renderIdentity(candidate, this.root, entry.page)) !==
        sha(images[index]!)
      )
        throw Error("render not bound to original PDF page");
      imagePaths.push((await this.artifact(images[index]!, "png")).path);
    }
    const receipt = {
      ...this.receipt(row, bytes, parsed, headers),
      quality: "reviewed-pages-visual-identity",
      imagePaths,
      review,
    };
    receipt.body.originalAttestationDate = review.originalAttestationDate;
    receipt.body.attestationDate = review.attestationDate;
    return this.run(row.source, "collect-rendered-pages-review", () =>
      this.commitPdf(
        row,
        bytes,
        "application/pdf",
        "explicit-private-rendered-pages-review",
        JSON.stringify(receipt),
      ),
    );
  }
  status() {
    const count = (table: string) =>
      this.db.query<{ n: number }, []>(`SELECT COUNT(*) n FROM ${table}`).get()!
        .n;
    return {
      sources: count("sources"),
      snapshots: count("snapshots"),
      observations: count("observations"),
      versions: count("versions"),
      runs: count("runs"),
      attempts: count("attempts"),
    };
  }
  private verifyHistory(): void {
    const mismatch = this.db
      .query(
        "SELECT 1 FROM history h JOIN observations o ON h.observation=o.id WHERE h.source<>o.source OR h.url<>o.url LIMIT 1",
      )
      .get();
    const orphan = this.db
      .query(
        "SELECT 1 FROM versions v WHERE NOT EXISTS(SELECT 1 FROM history h WHERE h.source=v.source AND h.url=v.url AND h.sha=v.sha) LIMIT 1",
      )
      .get();
    const missing = this.db
      .query(
        "SELECT 1 FROM observations o WHERE status='downloaded' AND NOT EXISTS(SELECT 1 FROM history h WHERE h.observation=o.id) LIMIT 1",
      )
      .get();
    if (mismatch || orphan || missing)
      throw new Error("bidirectional history identity/completeness mismatch");
  }
  async archiveIntegrity(): Promise<void> {
    verifySchema(this.db);
    verifyProducing(this.db);
    await verifyArtifacts(this);
    await this.verifySnapshots();
    this.verifyHistory();
    const all = this.db.query<Version, []>("SELECT * FROM versions").all();
    for (const version of all) await this.verifyVersion(version);
  }
  async preflight(): Promise<void> {
    await this.archiveIntegrity();
    await verifyRepresentations(this);
    verifyTransportLedger(this);
  }
  async verify(source: Source, selection: Selection) {
    await this.preflight();
    const selected = this.list(source, selection);
    if (!selected.length) throw new Error("no selected observations");
    let versions = 0;
    for (const row of selected)
      versions += this.selectedHistory(row, selection.captureOnly === true);
    if (selection.captureOnly)
      return {
        documents: selected.length,
        versions,
        httpRequests: 0,
        quality: ORIGINAL_QUALITY,
        semanticIdentityValidated: false,
        structuredInterpretation: false,
      };
    return { documents: selected.length, versions, httpRequests: 0 };
  }
  private selectedHistory(row: Listed, captureOnly = false): number {
    const oversized = this.db
      .query(
        "SELECT 1 FROM history h JOIN versions v ON h.source=v.source AND h.url=v.url AND h.sha=v.sha WHERE h.observation=? AND v.bytes>? LIMIT 1",
      )
      .get(row.id, this.maxPdfBytes);
    if (oversized)
      throw Error(
        "current caller PDF byte budget exceeded by retained original",
      );
    const count = this.db
      .query<{ n: number }, [string]>(
        "SELECT COUNT(*) n FROM history WHERE observation=?",
      )
      .get(row.id)!.n;
    if (row.status !== (captureOnly ? "captured" : "downloaded") || !count)
      throw new Error("selected download incomplete");
    return count;
  }
  async readArtifact(path: string): Promise<Buffer> {
    if (!/^[a-f0-9]{64}\.(?:html|pdf|candidate|wire|png|txt)$/.test(path))
      throw new Error("unsafe artifact path");
    const full = join(this.root, path);
    const stat = await statFile(full);
    if (!stat?.isFile()) throw new Error("missing artifact");
    const body = await readFile(full);
    requireArtifactReceipt(this.db, path, body);
    return body;
  }
  private async verifyVersion(version: Version): Promise<void> {
    const bytes = await this.readArtifact(version.path);
    await this.readArtifact(`${version.sha}.candidate`);
    if (bytes.length !== version.bytes || sha(bytes) !== version.sha)
      throw new Error("version checksum mismatch");
    requirePdf(bytes, version.mime, version.bytes);
    const latest = this.db
      .query(
        "SELECT 1 FROM validation_history WHERE source=? AND url=? AND sha=? AND receipt_hash=? AND receipt=?",
      )
      .get(
        version.source,
        version.url,
        version.sha,
        sha(version.validation),
        version.validation,
      );
    if (!latest) throw new Error("version validation receipt mismatch");
    const rows = this.db
      .query<
        { observation: string; receipt: string; receipt_hash: string },
        [string, string, string]
      >(
        "SELECT h.observation,v.receipt,v.receipt_hash FROM history h JOIN history_receipts r ON r.observation=h.observation AND r.sha=h.sha JOIN validation_history v ON v.source=h.source AND v.url=h.url AND v.sha=h.sha AND v.receipt_hash=r.receipt_hash WHERE h.source=? AND h.url=? AND h.sha=?",
      )
      .all(version.source, version.url, version.sha);
    const expected = this.db
      .query<{ n: number }, [string, string, string]>(
        "SELECT COUNT(*) n FROM history WHERE source=? AND url=? AND sha=?",
      )
      .get(version.source, version.url, version.sha)!.n;
    if (rows.length !== expected)
      throw new Error("history validation receipt missing");
    const parsed =
      JSON.parse(version.validation).schema === 9
        ? await inspectOriginal(join(this.root, version.path))
        : await inspectPdf(join(this.root, version.path));
    for (const row of rows)
      await this.verifyReceipt(version, bytes, parsed, row);
  }
  private async verifyReceipt(
    version: Version,
    bytes: Buffer,
    parsed: Awaited<ReturnType<typeof inspectPdf>>,
    history: { observation: string; receipt: string; receipt_hash: string },
  ) {
    if (sha(history.receipt) !== history.receipt_hash)
      throw new Error("validation receipt hash mismatch");
    const row = this.observation(history.observation),
      receipt = JSON.parse(history.receipt);
    requireSourceReceipt(row, receipt);
    if (receipt.schema === 9) {
      await verifyCaptureReceipt(
        this,
        row,
        receipt,
        join(this.root, version.path),
        parsed,
        bytes,
        version.mime,
      );
      return;
    }
    if (receipt.schema === undefined) {
      this.verifyLegacyReceipt(receipt, parsed, row);
      return;
    }
    const checks = [
      knownReceiptSchema(receipt),
      receipt.documentSha256 === version.sha,
      JSON.stringify(receipt.selection) ===
        JSON.stringify(selectedIdentity(row)),
      receipt.parser === "Poppler",
      receipt.structuredInterpretation === false,
      receipt.textHash === sha(parsed.text),
      receipt.info === parsed.info,
      receipt.pages === parsed.pages,
    ];
    if (!checks.every(Boolean))
      throw new Error("validation receipt schema/selection mismatch");
    if (receipt.quality === "image-only-visual-identity") {
      await this.verifyRendered(receipt, row, bytes, version.path, parsed.text);
      return;
    }
    if (receipt.quality === "reviewed-pages-visual-identity") {
      await this.verifyRenderedPages(
        receipt,
        row,
        bytes,
        version.path,
        parsed.text,
      );
      return;
    }
    if (
      receipt.quality !== "text-identity-only" ||
      JSON.stringify(receipt.body) !==
        JSON.stringify(receiptBody(parsed.text, receipt.schema))
    )
      throw new Error("validation body receipt mismatch");
    requireTextIdentity(parsed.text, row);
  }
  private verifyLegacyReceipt(
    receipt: unknown,
    parsed: Awaited<ReturnType<typeof inspectPdf>>,
    row: Evidence,
  ): void {
    const expected = {
      parser: "Poppler",
      quality: "text-identity-only",
      structuredInterpretation: false,
      textHash: sha(parsed.text),
      info: parsed.info,
      publicationDate: null,
    };
    if (JSON.stringify(receipt) !== JSON.stringify(expected))
      throw new Error("legacy validation receipt mismatch");
    requireTextIdentity(parsed.text, row);
  }
  private async verifyRendered(
    receipt: {
      schema: number;
      body: unknown;
      pages: number;
      review: RenderedReview;
      imagePath: string;
    },
    row: Evidence,
    bytes: Buffer,
    path: string,
    text: string,
  ): Promise<void> {
    const expected =
      receipt.schema === 2 ? legacyBodyEvidence(text) : bodyEvidence(text);
    expected.originalAttestationDate = receipt.review.originalAttestationDate;
    expected.attestationDate = receipt.review.attestationDate;
    if (
      receipt.pages !== 1 ||
      JSON.stringify(expected) !== JSON.stringify(receipt.body)
    )
      throw new Error("rendered body receipt mismatch");
    const image = await this.readArtifact(receipt.imagePath);
    requireReview(receipt.review, row, bytes, image);
    if (
      sha(await renderIdentity(join(this.root, path), this.root)) !== sha(image)
    )
      throw new Error("rendered identity image mismatch");
  }
  private async verifyRenderedPages(
    receipt: {
      schema: number;
      body: unknown;
      pages: number;
      review: PageReview;
      imagePaths: string[];
    },
    row: Evidence,
    bytes: Buffer,
    path: string,
    text: string,
  ): Promise<void> {
    if (receipt.schema !== 4 || !Array.isArray(receipt.imagePaths))
      throw Error("rendered pages receipt schema mismatch");
    const images = [];
    for (const imagePath of receipt.imagePaths)
      images.push(await this.readArtifact(imagePath));
    requirePageReview(receipt.review, row, bytes, images, receipt.pages);
    const expected = bodyEvidence(text);
    expected.originalAttestationDate = receipt.review.originalAttestationDate;
    expected.attestationDate = receipt.review.attestationDate;
    if (JSON.stringify(expected) !== JSON.stringify(receipt.body))
      throw Error("rendered pages body mismatch");
    for (const [index, entry] of receipt.review.pages.entries()) {
      if (
        sha(
          await renderIdentity(join(this.root, path), this.root, entry.page),
        ) !== sha(images[index]!)
      )
        throw Error("rendered page image mismatch");
    }
  }
  private async verifySnapshots(): Promise<void> {
    const snapshots = this.db
      .query<Snapshot, []>("SELECT * FROM snapshots ORDER BY rowid")
      .all();
    const admitted = new Map<Source, Set<string>>();
    for (const snapshot of snapshots) {
      const urls =
        admitted.get(snapshot.source) ??
        new Set<string>(sources[snapshot.source].pages);
      this.redirectPages(snapshot.source, urls);
      if (!urls.has(snapshot.url))
        throw Error("discovery source-linked provenance mismatch");
      await this.verifySnapshot(snapshot);
      for (const link of pageLinks(
        snapshot.source,
        snapshot.url,
        (await this.readArtifact(snapshot.path)).toString(),
      ))
        urls.add(link.url);
      admitted.set(snapshot.source, urls);
    }
  }
  private snapshotMeta(id: string): SnapshotMeta {
    const meta = this.db
      .query<SnapshotMeta, [string]>(
        "SELECT * FROM snapshot_metadata WHERE snapshot=?",
      )
      .get(id);
    if (!meta || ![1, 2, 3, 4, 5, 6, 7].includes(meta.adapter_schema))
      throw new Error("snapshot schema receipt missing");
    if (
      (meta.headers === null ? null : sha(meta.headers)) !== meta.headers_hash
    )
      throw new Error("snapshot header receipt mismatch");
    return meta;
  }
  private requireSnapshotSource(source: Source, meta: SnapshotMeta): void {
    if (cityPublication(source) && archiveVersion(this.db) !== 5)
      throw Error("City metadata requires physical archive5");
    if (
      (source === "austin-financial-publications") !==
      [4, 5].includes(meta.adapter_schema)
    )
      throw Error("source/adapter metadata version mismatch");
    if (
      cityPublication(source) !== [6, 7].includes(meta.adapter_schema) ||
      (meta.adapter_schema === 7 && source !== "austin-council-archives")
    )
      throw Error("City source/adapter metadata6 mismatch");
  }
  private async verifySnapshot(snapshot: Snapshot): Promise<void> {
    const bytes = await this.readArtifact(snapshot.path);
    if (sha(bytes) !== snapshot.sha) throw new Error("snapshot hash mismatch");
    const meta = this.snapshotMeta(snapshot.id);
    this.requireSnapshotSource(snapshot.source, meta);
    const policyRun = this.db
      .query<{ kind: string; source: string; status: string }, [string]>(
        "SELECT kind,source,status FROM runs WHERE id=?",
      )
      .get(snapshot.run);
    if (
      (meta.adapter_schema === 7) !==
      (policyRun?.kind === LEGACY_METADATA_RUN)
    )
      throw Error("metadata7 endpoint-policy run/marker mismatch");
    if (
      meta.adapter_schema === 7 &&
      (policyRun?.source !== snapshot.source || policyRun.status !== "complete")
    )
      throw Error("metadata7 current producing interpretation run mismatch");
    const expected = discover(
      snapshot.source,
      snapshot.url,
      bytes.toString(),
      meta.adapter_schema,
    )
      .map((row) => this.serializedEvidence(row, meta.adapter_schema))
      .sort();
    const stored = this.db
      .query<
        { id: string; evidence: string; source: string; url: string },
        [string]
      >("SELECT * FROM observations WHERE snapshot=?")
      .all(snapshot.id);
    for (const row of stored) this.observation(row.id);
    const sourceValid = stored.every((row) => row.source === snapshot.source);
    if (
      !sourceValid ||
      meta.observation_count !== stored.length ||
      JSON.stringify(expected) !==
        JSON.stringify(stored.map((row) => row.evidence).sort())
    )
      throw new Error("observation inventory mismatch");
  }
  private serializedEvidence(row: Evidence, schema: number): string {
    const projected = { ...row } as Record<string, unknown>;
    if (schema === 1)
      for (const key of ["fiscalYear", "taxYear", "administeringCounty"])
        delete projected[key];
    return JSON.stringify(projected);
  }
}
