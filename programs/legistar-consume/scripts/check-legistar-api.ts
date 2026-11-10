import { Command } from "commander";
import { version } from "../package.json";
import { CheckedOutput } from "../src/util/output";

const firefoxUserAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0";

type CheckResult = {
  name: string;
  url: string;
  status?: number;
  statusText?: string;
  contentType?: string | null;
  bodyPreview?: string;
  error?: string;
};

const checks = [
  {
    name: "API events, Austin client",
    url: "https://webapi.legistar.com/v1/austin/Events?$top=1",
  },
  {
    name: "API bodies, Austin client",
    url: "https://webapi.legistar.com/v1/austin/Bodies?$top=1",
  },
  {
    name: "API event items endpoint shape, Austin client",
    url: "https://webapi.legistar.com/v1/austin/Events/1362250/EventItems?AgendaNote=1&MinutesNote=1&Attachments=1",
  },
  {
    name: "API events, AustinTexas client guess",
    url: "https://webapi.legistar.com/v1/austintexas/Events?$top=1",
  },
  {
    name: "API City Council date lookup, AustinTexas client",
    url: "https://webapi.legistar.com/v1/austintexas/Events?$filter=EventDate%20ge%20datetime%272026-05-21%27%20and%20EventDate%20lt%20datetime%272026-05-22%27",
  },
  {
    name: "API City Council event items, AustinTexas client",
    url: "https://webapi.legistar.com/v1/austintexas/Events/4072/EventItems?AgendaNote=1&MinutesNote=1&Attachments=1",
  },
  {
    name: "API events over HTTP",
    url: "http://webapi.legistar.com/v1/austin/Events?$top=1",
  },
  {
    name: "Public portal calendar fallback",
    url: "https://austintexas.legistar.com/Calendar.aspx",
  },
  {
    name: "Public portal known meeting fallback",
    url: "https://austintexas.legistar.com/MeetingDetail.aspx?ID=1362250&GUID=E4E3F7D2-A087-4945-A577-2603C94AFDDD&Options=info|&Search=",
  },
];

type CheckOptions = {
  fetcher?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
};
function requestDeadline(options: CheckOptions) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abort = () => controller.abort(new Error("diagnostic interrupted"));
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new Error("diagnostic deadline exceeded"));
    }, options.timeoutMs ?? 10_000);
    controller.signal.addEventListener(
      "abort",
      () => reject(controller.signal.reason),
      { once: true },
    );
    if (controller.signal.aborted) reject(controller.signal.reason);
  });
  const cleanup = () => {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    controller.abort();
  };
  return { controller, deadline, cleanup };
}
type BodyState = { reader?: ReadableStreamDefaultReader<Uint8Array> };
async function readPreview(
  response: Response,
  maxBytes: number,
  body: BodyState,
): Promise<string> {
  body.reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let size = 0,
    text = "";
  while (body.reader) {
    const { done, value } = await body.reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes)
      throw new Error("diagnostic response byte limit exceeded");
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text.replace(/\s+/g, " ").trim().slice(0, 220);
}
async function requestCheck(
  name: string,
  url: string,
  options: CheckOptions,
  controller: AbortController,
  body: BodyState,
): Promise<CheckResult> {
  const started = performance.now();
  const response = await (options.fetcher ?? fetch)(url, {
    redirect: "manual",
    signal: controller.signal,
    headers: {
      Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
      "User-Agent": firefoxUserAgent,
    },
  });
  // A non-cooperative fixture/transport may settle after the deadline.
  if (controller.signal.aborted) {
    void response.body?.cancel().catch(() => {});
    throw controller.signal.reason;
  }
  const elapsedMs = Math.round(performance.now() - started);
  const bodyPreview = await readPreview(
    response,
    options.maxBytes ?? 65_536,
    body,
  );
  return {
    name,
    url,
    status: response.status,
    statusText: `${response.statusText} (${elapsedMs}ms)`,
    contentType: response.headers.get("content-type"),
    bodyPreview,
  };
}
function cancelReader(reader: BodyState["reader"]): void {
  // Cancel without an unbounded cleanup await (a stalled source may ignore it).
  if (reader)
    void reader
      .cancel()
      .catch(() => {})
      .finally(() => {
        try {
          reader.releaseLock();
        } catch {}
      });
}
export async function check(
  name: string,
  url: string,
  options: CheckOptions = {},
): Promise<CheckResult> {
  const request = requestDeadline(options);
  const body: BodyState = {};
  try {
    return await Promise.race([
      requestCheck(name, url, options, request.controller, body),
      request.deadline,
    ]);
  } catch (error) {
    const message =
      error instanceof Error &&
      /^diagnostic (deadline|response byte limit|interrupted)/.test(
        error.message,
      )
        ? error.message
        : "diagnostic request failed";
    return { name, url, error: message };
  } finally {
    request.cleanup();
    cancelReader(body.reader);
  }
}

function successful(result: CheckResult): boolean {
  return Boolean(result.status && result.status >= 200 && result.status < 300);
}
function requiresToken(result: CheckResult): boolean {
  return (
    [401, 403].includes(result.status ?? 0) &&
    /key|token|required|unauthor/i.test(
      result.bodyPreview ?? `${result.statusText ?? ""}`,
    )
  );
}
export function classify(results: CheckResult[]): string {
  const apiResults = results.filter((result) =>
    result.url.includes("webapi.legistar.com"),
  );
  const targetSuccess = apiResults.find(
    (result) =>
      result.name.includes("City Council event items") && successful(result),
  );
  const apiSuccess = apiResults.find(successful);
  const tokenRequired = apiResults.some(requiresToken);

  if (targetSuccess) {
    return "API is usable without a key for the requested City Council smoke case. Use client key `austintexas`; keep scraping as fallback.";
  }

  if (apiSuccess) {
    return `API appears usable without a key. First successful check: ${apiSuccess.name}.`;
  }

  if (tokenRequired) {
    return "API does not appear usable without a key/token. Start with scraping fallback.";
  }

  return "API access is inconclusive. Inspect check output before choosing API or scraping.";
}

function renderReport(
  results: CheckResult[],
  output: Pick<CheckedOutput, "line">,
): void {
  for (const result of results) {
    output.line(`\n## ${result.name}`);
    output.line(result.url);
    if (result.error) {
      output.line(`ERROR: ${result.error}`);
      continue;
    }
    output.line(`status: ${result.status} ${result.statusText}`);
    output.line(`content-type: ${result.contentType ?? "(none)"}`);
    output.line(`body: ${result.bodyPreview || "(empty)"}`);
  }
  output.line(`\n## Verdict`);
  output.line(classify(results));
}
export function createDiagnosticProgram(messages: string[] = []): Command {
  return new Command()
    .name("check-legistar-api")
    .description(
      "Bounded Legistar access diagnostic. Plain invocation performs nine serial diagnostic checks and prints the report and classification (status 0 even if inconclusive). Each request has a 10-second deadline and 64 KiB body limit; redirects are reported, not followed. SIGINT/SIGTERM return 130/143 after a partial report. Run only with provider access authorization. No credentials or config are needed for help/version.",
    )
    .usage("[-h|--help|--version]")
    .helpOption(false)
    .option("-h, --help", "display help")
    .option("--version", "display package version")
    .exitOverride()
    .configureOutput({
      writeOut: (text) => {
        messages.push(text);
      },
      writeErr: (text) => {
        messages.push(text);
      },
    });
}
export async function main(
  args: string[],
  output: Pick<CheckedOutput, "line" | "flush"> = new CheckedOutput(),
) {
  const program = createDiagnosticProgram();
  const parsed = program.parseOptions(args);
  if (parsed.unknown.length)
    throw new Error("Unknown option; use check-legistar-api --help");
  if (parsed.operands.length)
    throw new Error("Unexpected operand; use check-legistar-api --help");
  const values = program.opts();
  if (values.help) {
    output.line(program.helpInformation());
    await output.flush();
    return;
  }
  if (values.version) {
    output.line(`check-legistar-api ${version}`);
    await output.flush();
    return;
  }
  const controller = new AbortController();
  let interrupted = 0;
  const interrupt = () => {
    interrupted = 130;
    controller.abort();
  };
  const terminate = () => {
    interrupted = 143;
    controller.abort();
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  const results: CheckResult[] = [];
  try {
    for (const item of checks) {
      if (controller.signal.aborted) break;
      results.push(
        await check(item.name, item.url, { signal: controller.signal }),
      );
    }

    renderReport(results, output);
    await output.flush();
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    if (interrupted) process.exitCode = interrupted;
  }
}
if (import.meta.main)
  main(process.argv.slice(2))
    .then(() => {
      // All report bytes are observed. Do not let a non-cooperative transport or
      // cancellation cleanup keep this standalone diagnostic alive indefinitely.
      process.exit(Number(process.exitCode ?? 0));
    })
    .catch(async (error) => {
      const message =
        error instanceof Error &&
        error.message.startsWith("stdout delivery failed")
          ? error.message
          : "diagnostic failed; use --help for usage";
      const diagnostics = new CheckedOutput(2);
      diagnostics.line(`check-legistar-api: ${message}`);
      await diagnostics.flush().catch(() => {});
      process.exit(1);
    });
