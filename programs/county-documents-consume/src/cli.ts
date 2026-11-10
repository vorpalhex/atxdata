import { Command as Commander, Option } from "commander";
import { parseCLI as parseOptions } from "./cli-parser";
import { readFile } from "node:fs/promises";
import metadata from "../package.json";
import { writeStdout } from "./cli-output";
import { workBudget, type WorkBudget } from "./budgets";
import { statFile } from "../../civicclerk-consume/src/archive";
import { Engine } from "./engine";
import { pageUrl } from "./discovery";
import { requireArchiveEndpoint } from "./historical";
import { sourceName, type Selection } from "./adapters";
import { Transport } from "./transport";
import {
  reviewSelectionHash,
  type RenderedReview,
  type PageReview,
} from "./pdf";

const help = `County document acquisition (private local originals only)
Usage: bun run src/cli.ts COMMAND [options]
  bun run src/cli.ts COMMAND --root APPROVED_PRIVATE_DIRECTORY [options]
  status|catalog --source SOURCE (catalog requires source; status does not)
  list|verify --source SOURCE --limit N [--year YYYY --chapter TOKEN --date YYYY-MM-DD --role ROLE --url EXACT_URL]
  import-page --source SOURCE --page EXACT_DISCOVERY_URL --input FILE --origin RETAINED_LABEL [--headers FILE]
  import-pdf --observation ID --input FILE --origin RETAINED_LABEL [--headers FILE]
  review-context --observation ID
  review-pdf --observation ID --input FILE (--image PNG | --images PATHS_JSON) --review JSON [--headers FILE]
  archive --source-href EXACT_PUBLISHED_HREF --page EXPLICIT_HTTPS_ENDPOINT [--archive-value VALUE] --allow-network [--human]
  discover --source SOURCE --page EXACT_DISCOVERY_URL --allow-network [--human]
  collect|sync --source SOURCE --limit N [selection options] --allow-network
Help: -h, --help, help COMMAND; --version reports the declared package version offline.
Examples (offline): status --root APPROVED_PRIVATE_DIRECTORY; list --root APPROVED_PRIVATE_DIRECTORY --source county-code --limit 1.
Discovery workflow: import-page/discover -> catalog/list IDs -> review-context/import-pdf -> collect/verify. Explicit --allow-network is always required for network commands.
Sources: county-code, budgets, meeting-archives, election-documents.
Work budgets: --max-requests N (100), --max-bytes N (536870912), --max-pdf-bytes N (134217728), --max-pages N (50). Positive safe integers, per operation, not archive-lifetime quotas. Import and collect share PDF bounds; import/review also honor aggregate body/image byte budgets. Metadata stays3MiB/page and aggregate2000 document occurrences/source.
Discovery follows only actual retained links in relevant source paths; bounded traversal returns complete/pending. catalog reports retained links/selectors and blocked original hrefs, not fabricated routes.
--human is a boolean default-false operator acknowledgement, not identity spoofing. Only the exact enCodePlus Travis County tenant robots disallow can be acknowledged; all other gates remain. archive currently obtains the published selector/catalog or applies its read-only filter with fresh own anonymous state and server-selected readback. It does NOT yet acquire historical PDF bodies.
No redirects/retries/scheduler/server. Global durable >=3second completion pacing, robots, cooldowns, stop gates and history never reset between operations. collect verifies existing selected downloads without HTTP; sync explicitly requests new bytes. Interrupted artifacts/wire fail closed pending manual recovery.
review-pdf accepts explicit reviewed physical pages and image/selection hashes, preserving legacy one-page receipts. Not OCR, interpretation or unattended acceptance. See README for review JSON and source caveats.
`;
function commandHelp(command?: string): string {
  if (!command) return createProgram().helpInformation() + "\n" + help;
  const lines = help.split("\n");
  const synopsis = lines.find((line) =>
    line.trim().split(" ")[0]?.split("|").includes(command),
  );
  return `County document ${command}\nUsage: bun run src/cli.ts ${command} --root APPROVED_PRIVATE_DIRECTORY [options]\n${synopsis ?? ""}\n${createProgram().helpInformation()}\n${lines.slice(lines.findIndex((line) => line.startsWith("Sources:"))).join("\n")}\nUse --help for the complete command surface and README for source/review details.`;
}
type Options = Record<string, string>;
const COMMANDS = [
  "list",
  "verify",
  "status",
  "catalog",
  "import-page",
  "import-pdf",
  "review-pdf",
  "review-context",
  "discover",
  "collect",
  "sync",
  "archive",
] as const;
type Command = (typeof COMMANDS)[number];
const NETWORK = new Set<string>(["discover", "collect", "sync", "archive"]);
export function createProgram() {
  const program = new Commander()
    .name("county-documents-consume")
    .description("County document acquisition (private local originals only)")
    .usage("COMMAND [options]")
    .helpOption(false);
  program.addOption(new Option("-h, --help", "Offline help"));
  program.addOption(
    new Option("--version", "Declared package version, offline"),
  );
  program.addOption(
    new Option("--root <value>", "Approved private archive directory"),
  );
  program.addOption(new Option("--source <value>", "Exact source ID"));
  program.addOption(
    new Option("--limit <value>", "Finite selected document limit"),
  );
  program.addOption(new Option("--year <value>", "Exact source year token"));
  program.addOption(
    new Option("--chapter <value>", "Exact source chapter token"),
  );
  program.addOption(new Option("--date <value>", "Exact source date token"));
  program.addOption(new Option("--role <value>", "Exact source role token"));
  program.addOption(
    new Option("--url <value>", "Exact published document URL"),
  );
  program.addOption(
    new Option("--page <value>", "Exact source-linked discovery URL"),
  );
  program.addOption(new Option("--input <value>", "Retained input file"));
  program.addOption(
    new Option("--origin <value>", "Retained provenance label"),
  );
  program.addOption(
    new Option("--observation <value>", "Retained observation ID"),
  );
  program.addOption(
    new Option("--headers <value>", "Retained original headers file"),
  );
  program.addOption(new Option("--image <value>", "Reviewed single-page PNG"));
  program.addOption(
    new Option("--images <value>", "Reviewed page image paths JSON"),
  );
  program.addOption(
    new Option("--review <value>", "Explicit rendered-review JSON"),
  );
  program.addOption(
    new Option(
      "--allow-network",
      "Explicit authorization for network commands",
    ).default(false),
  );
  program.addOption(
    new Option(
      "--human",
      "Default-false operator acknowledgement; never identity spoofing",
    ).default(false),
  );
  program.addOption(
    new Option("--source-href <value>", "Exact published archive source href"),
  );
  program.addOption(
    new Option("--archive-value <value>", "Published archive selector value"),
  );
  program.addOption(
    new Option(
      "--max-pdf-bytes <value>",
      "Positive safe-integer operation budget; see defaults below",
    ),
  );
  program.addOption(
    new Option(
      "--max-bytes <value>",
      "Positive safe-integer operation budget; see defaults below",
    ),
  );
  program.addOption(
    new Option(
      "--max-requests <value>",
      "Positive safe-integer operation budget; see defaults below",
    ),
  );
  program.addOption(
    new Option(
      "--max-pages <value>",
      "Positive safe-integer operation budget; see defaults below",
    ),
  );
  for (const name of COMMANDS)
    program.command(name).description(name.replaceAll("-", " "));
  return program;
}
function parseCLI(args: string[]) {
  return parseOptions(createProgram(), args);
}
function required(opts: Options, name: string): string {
  const value = opts[name];
  if (!value) throw new Error(`required --${name}`);
  return value;
}
function budgets(opts: Options): WorkBudget {
  const values: Partial<WorkBudget> = {};
  for (const [flag, key] of [
    ["max-pdf-bytes", "maxPdfBytes"],
    ["max-bytes", "maxBytes"],
    ["max-requests", "maxRequests"],
    ["max-pages", "maxPages"],
  ] as const) {
    if (opts[flag] === undefined) continue;
    if (!/^\d+$/.test(opts[flag]!)) throw Error(`invalid ${flag} budget`);
    values[key] = Number(opts[flag]);
  }
  return workBudget(values);
}
function selection(opts: Options): Selection {
  const limit = required(opts, "limit");
  if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 2000)
    throw new Error("invalid --limit");
  return {
    limit: Number(limit),
    year: opts.year,
    chapter: opts.chapter,
    date: opts.date,
    role: opts.role,
    url: opts.url,
  };
}
async function input(
  opts: Options,
  key: string,
  limit: number,
): Promise<Buffer> {
  const path = required(opts, key),
    stat = await statFile(path);
  if (!stat?.isFile() || stat.size > limit)
    throw new Error("input missing or exceeds byte limit");
  return readFile(path);
}
async function headers(opts: Options): Promise<string | null> {
  return opts.headers ? (await input(opts, "headers", 65536)).toString() : null;
}
async function importPage(engine: Engine, opts: Options) {
  return engine.importPage(
    sourceName(required(opts, "source")),
    required(opts, "page"),
    (
      await input(
        opts,
        "input",
        Math.min(3 * 1024 * 1024, budgets(opts).maxBytes),
      )
    ).toString(),
    required(opts, "origin"),
    await headers(opts),
  );
}
async function importPdf(engine: Engine, opts: Options) {
  return engine.importPdf(
    required(opts, "observation"),
    await input(
      opts,
      "input",
      Math.min(engine.maxPdfBytes, budgets(opts).maxBytes),
    ),
    "application/pdf",
    required(opts, "origin"),
    await headers(opts),
  );
}
async function reviewPdf(engine: Engine, opts: Options) {
  const review = JSON.parse((await input(opts, "review", 65536)).toString()) as
    RenderedReview | PageReview;
  const bytes = await input(
    opts,
    "input",
    Math.min(engine.maxPdfBytes, budgets(opts).maxBytes),
  );
  let remaining = budgets(opts).maxBytes - bytes.length;
  if ("pages" in review) {
    if (opts.image) throw Error("use images, not image, for page review");
    const paths: unknown = JSON.parse(
      (await input(opts, "images", 65536)).toString(),
    );
    if (
      !Array.isArray(paths) ||
      paths.length !== review.pages.length ||
      paths.some((path) => typeof path !== "string")
    )
      throw Error("invalid reviewed image paths");
    const images = [];
    for (const path of paths) {
      const image = await input(
        { input: path },
        "input",
        Math.min(remaining, 5 * 1024 * 1024),
      );
      images.push(image);
      remaining -= image.length;
    }
    return engine.acceptRenderedPages(
      required(opts, "observation"),
      bytes,
      images,
      review,
      await headers(opts),
    );
  }
  return engine.acceptRendered(
    required(opts, "observation"),
    bytes,
    await input(opts, "image", Math.min(remaining, 5 * 1024 * 1024)),
    review,
    await headers(opts),
  );
}
async function collect(engine: Engine, opts: Options, refresh: boolean) {
  const source = sourceName(required(opts, "source")),
    scope = selection(opts),
    rows = engine.list(source, scope);
  if (!rows.length) throw new Error("no selected observations");
  const transport = new Transport(engine, {}, budgets(opts), {
      human: opts.human === "yes",
    }),
    outcomes = [];
  for (const row of rows) {
    if (!refresh && row.status === "downloaded")
      outcomes.push(
        await engine.verify(source, { ...scope, url: row.url, limit: 1 }),
      );
    else outcomes.push(await transport.collect(row.id));
  }
  return outcomes;
}
const ACTIONS: Record<Command, (engine: Engine, opts: Options) => unknown> = {
  archive: (engine, opts) =>
    new Transport(engine, {}, budgets(opts), {
      human: opts.human === "yes",
    }).archive(
      required(opts, "source-href"),
      required(opts, "page"),
      opts["archive-value"],
    ),
  status: (engine) => engine.status(),
  catalog: (engine, opts) =>
    engine.discoveryCatalog(sourceName(required(opts, "source"))),
  "review-context": (engine, opts) => {
    const row = engine.observation(required(opts, "observation"));
    return { selectionSha256: reviewSelectionHash(row), evidence: row };
  },
  list: (engine, opts) =>
    engine.list(sourceName(required(opts, "source")), selection(opts)),
  verify: (engine, opts) =>
    engine.verify(sourceName(required(opts, "source")), selection(opts)),
  "import-page": importPage,
  "import-pdf": importPdf,
  "review-pdf": reviewPdf,
  discover: (engine, opts) =>
    new Transport(engine, {}, budgets(opts), {
      human: opts.human === "yes",
    }).discoverTree(
      sourceName(required(opts, "source")),
      required(opts, "page"),
    ),
  collect: (engine, opts) => collect(engine, opts, false),
  sync: (engine, opts) => collect(engine, opts, true),
};
// Pure CLI requirements precede opening the archive; action/library guards remain.
function validate(command: Command, opts: Options): void {
  required(opts, "root");
  if (
    [
      "catalog",
      "list",
      "verify",
      "import-page",
      "discover",
      "collect",
      "sync",
    ].includes(command)
  )
    sourceName(required(opts, "source"));
  if (["list", "verify", "collect", "sync"].includes(command)) selection(opts);
  const operands: Partial<Record<Command, string[]>> = {
    archive: ["source-href", "page"],
    discover: ["page"],
    "import-page": ["page", "input", "origin"],
    "import-pdf": ["observation", "input", "origin"],
    "review-context": ["observation"],
    "review-pdf": ["observation", "input", "review"],
  };
  for (const key of operands[command] ?? []) required(opts, key);
  validateTarget(command, opts);
  if (command === "review-pdf") validateReviewImages(opts);
}
// Pure admissibility only; retained-child membership remains engine-owned.
function validateTarget(command: Command, opts: Options): void {
  if (command === "import-page" || command === "discover") {
    const page = required(opts, "page");
    if (pageUrl(sourceName(required(opts, "source")), page, page) !== page)
      throw Error("noncanonical source-linked discovery URL");
  }
  if (command === "archive")
    requireArchiveEndpoint(
      required(opts, "source-href"),
      required(opts, "page"),
    );
}
function validateReviewImages(opts: Options): void {
  if (opts.image && opts.images)
    throw Error("use either --image or --images, not both");
  if (!opts.image && !opts.images) throw Error("required --image or --images");
}
export async function run(args: string[]): Promise<unknown> {
  const parsed = parseCLI(args),
    command = parsed.command;
  if (parsed.info === "version")
    return `county-documents-consume ${metadata.version}`;
  if (parsed.info === "help") return commandHelp(command);
  if (!command) {
    if (Object.keys(parsed.flags).length)
      throw Error("required command; see --help");
    return commandHelp();
  }
  const opts: Options = Object.fromEntries(
    Object.entries(parsed.flags).map(([key, value]) => [key.slice(2), value]),
  );
  if (NETWORK.has(command) && opts["allow-network"] !== "yes")
    throw new Error("network requires --allow-network");
  const budget = budgets(opts);
  validate(command as Command, opts);
  const engine = await Engine.open(required(opts, "root"), {
    maxPdfBytes: budget.maxPdfBytes,
  });
  try {
    return await ACTIONS[command as Command](engine, opts);
  } finally {
    await engine.close();
  }
}
if (import.meta.main)
  run(Bun.argv.slice(2))
    .then((result) =>
      writeStdout(
        (typeof result === "string"
          ? result
          : JSON.stringify(result, null, 2)) + "\n",
      ),
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
