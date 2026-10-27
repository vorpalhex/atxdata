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

async function check(name: string, url: string): Promise<CheckResult> {
  try {
    const started = performance.now();
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
        "User-Agent": firefoxUserAgent,
      },
    });
    const elapsedMs = Math.round(performance.now() - started);
    const text = await response.text();

    return {
      name,
      url,
      status: response.status,
      statusText: `${response.statusText} (${elapsedMs}ms)`,
      contentType: response.headers.get("content-type"),
      bodyPreview: text.replace(/\s+/g, " ").trim().slice(0, 220),
    };
  } catch (error) {
    return {
      name,
      url,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function classify(results: CheckResult[]): string {
  const apiResults = results.filter((result) => result.url.includes("webapi.legistar.com"));
  const targetSuccess = apiResults.find((result) =>
    result.name.includes("City Council event items") &&
    result.status &&
    result.status >= 200 &&
    result.status < 300,
  );
  const apiSuccess = apiResults.find((result) => result.status && result.status >= 200 && result.status < 300);
  const requiresToken = apiResults.some((result) =>
    [401, 403].includes(result.status ?? 0) &&
    /key|token|required|unauthor/i.test(result.bodyPreview ?? `${result.statusText ?? ""}`),
  );

  if (targetSuccess) {
    return "API is usable without a key for the requested City Council smoke case. Use client key `austintexas`; keep scraping as fallback.";
  }

  if (apiSuccess) {
    return `API appears usable without a key. First successful check: ${apiSuccess.name}.`;
  }

  if (requiresToken) {
    return "API does not appear usable without a key/token. Start with scraping fallback.";
  }

  return "API access is inconclusive. Inspect check output before choosing API or scraping.";
}

const results = await Promise.all(checks.map((item) => check(item.name, item.url)));

for (const result of results) {
  console.log(`\n## ${result.name}`);
  console.log(result.url);

  if (result.error) {
    console.log(`ERROR: ${result.error}`);
    continue;
  }

  console.log(`status: ${result.status} ${result.statusText}`);
  console.log(`content-type: ${result.contentType ?? "(none)"}`);
  console.log(`body: ${result.bodyPreview || "(empty)"}`);
}

console.log(`\n## Verdict`);
console.log(classify(results));

export {};
