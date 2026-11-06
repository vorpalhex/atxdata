import { Archive } from "./archive";
import { ensure, object, array, integer, same } from "./check";
import {
  configs,
  sharing,
  itemUrl,
  queryUrl,
  catalogQuery,
  validateCatalog,
  validateItem,
  validatePublishedItem,
  publishedStable,
  publishedRedirect,
  source,
  type Source,
} from "./sources";
import { allowed, terms } from "./rules";
import {
  selected,
  validateLayer,
  validateFeatures,
  authoritativeIds,
  reconcile,
} from "./geometry";
import { validateZip } from "./zip";
export type Command = "rules" | "discover" | "collect" | "sync";
export class Adapter {
  constructor(readonly archive: Archive) {
    for (const [id, c] of Object.entries(configs))
      archive.store.source(
        id,
        c.label,
        id === "tnr" ? c.layer : `${sharing}/content/items/${c.item}/data`,
      );
  }
  async execute(
    source: Source,
    command: Command,
    options: { termsSha256?: string; resume?: string } = {},
  ) {
    if (command === "collect" && !options.resume) {
      const prior = this.archive.store.latestCollection(source);
      if (prior) {
        await this.verify();
        return {
          run: prior.id,
          reused: true,
          summary: JSON.parse(prior.summary),
        };
      }
    }
    if (command !== "rules")
      ensure(
        /^[a-f0-9]{64}$/.test(options.termsSha256 ?? ""),
        "review rules output and supply --terms-sha256 before source traffic",
      );
    const run = options.resume
      ? this.archive.store.resume(options.resume, source, command)
      : this.archive.store.start(source, command);
    try {
      const summary = await this.acquire(
        run,
        source,
        command,
        options.termsSha256,
      );
      this.archive.store.finish(run, "succeeded", undefined, summary);
      return { run, reused: false, summary };
    } catch (error) {
      this.archive.store.finish(
        run,
        "failed",
        error instanceof Error ? error.message : "failed",
      );
      throw error;
    }
  }
  private async acquire(
    run: string,
    source: Source,
    command: Command,
    termsSha256?: string,
  ): Promise<unknown> {
    const robots = await this.gate(run, source);
    const config = configs[source];
    const item = await this.archive.request(
      run,
      "item-before",
      itemUrl(config.item),
      "json",
      (v) => validateItem(v, config.item),
    );
    const currentTerms = terms(item);
    if (command === "rules") {
      const summary = { source, terms: currentTerms, robots };
      return summary;
    }
    ensure(
      currentTerms.sha256 === termsSha256,
      "usage terms changed/unapproved; review rules output",
    );
    let summary: unknown;
    if (command === "discover") summary = await this.discover(run, source);
    else {
      if (source === "tnr") await this.features(run, item);
      else await this.published(run, item, robots);
      summary = await this.verifyCollection(run, source);
    }
    return summary;
  }
  private async gate(run: string, source: Source) {
    this.archive.guard = undefined;
    const origins = ["https://www.arcgis.com"];
    if (source === "tnr") origins.push(new URL(configs.tnr.layer).origin);
    const rules: Record<string, string> = {};
    for (const [i, origin] of origins.entries()) {
      const url = origin + "/robots.txt";
      let text: string;
      try {
        const value = await this.archive.request(
          run,
          `robots-${i}`,
          url,
          "text",
        );
        ensure(typeof value === "string", "robots body missing");
        text = value;
      } catch (error) {
        if (error instanceof Error && "status" in error && error.status === 404)
          text = "";
        else throw error;
      }
      const target =
        i === 0 ? itemUrl(configs[source].item) : configs.tnr.layer;
      this.archive.setSpacing(allowed(url, text, target));
      rules[origin] = text;
    }
    this.archive.guard = (url) => this.checkRoute(rules, url);
    return rules;
  }
  private checkRoute(rules: Record<string, string>, url: string) {
    const origin = new URL(url).origin;
    ensure(origin in rules, "authority missing robots gate");
    this.archive.setSpacing(
      allowed(origin + "/robots.txt", rules[origin], url),
    );
  }
  private async discover(run: string, source: Source) {
    const config = configs[source];
    await this.archive.request(
      run,
      "site-item",
      itemUrl(config.site),
      "json",
      (v) => validateItem(v, config.site),
    );
    const data = await this.archive.request(
      run,
      "site-data",
      itemUrl(config.site, true),
      "json",
    );
    const q = catalogQuery(source, data);
    const search = await this.archive.request(
      run,
      "catalog",
      queryUrl(sharing + "/search", {
        q,
        num: "100",
        start: "1",
        sortField: "title",
        sortOrder: "asc",
      }),
      "json",
      validateCatalog,
    );
    const results = validateCatalog(search);
    return {
      source,
      catalogItems: results.length,
      query: q,
      items: results.map((v) => {
        const item = object(v);
        return {
          id: item.id,
          title: item.title,
          type: item.type,
          url: item.url ?? null,
        };
      }),
      scope: "one catalog page; metadata only, no adjacent feature acquisition",
    };
  }
  private async features(run: string, itemValue: unknown) {
    const c = configs.tnr,
      item = object(itemValue);
    ensure(
      item.type === "Feature Service" && item.url === c.service,
      "named catalog service URL/type changed; no identity repair",
    );
    const service = object(
      await this.archive.request(
        run,
        "service",
        queryUrl(c.service, {}),
        "json",
      ),
    );
    ensure(
      array(service.layers).some((v) => {
        const layer = object(v);
        return (
          layer.id === 0 &&
          layer.name === "Travis_County_Commissioner_Precincts"
        );
      }),
      "named service layer changed",
    );
    const layer = await this.archive.request(
      run,
      "layer",
      queryUrl(c.layer, {}),
      "json",
      validateLayer,
    );
    const before = await this.count(run, "before");
    const count = integer(object(before).count, 1, 10);
    const ids = await this.ids(run, "before", count);
    authoritativeIds(ids, count);
    for (let offset = 0; offset < count; offset += 2) {
      const page = await this.archive.request(
        run,
        `page-${offset}`,
        queryUrl(c.layer + "/query", {
          where: "1=1",
          outFields: selected.join(","),
          returnGeometry: "true",
          orderByFields: "OBJECTID ASC",
          resultRecordCount: "2",
          resultOffset: String(offset),
        }),
        "json",
        (v) => validateFeatures(v, layer),
      );
      ensure(
        array(object(page).features).length === Math.min(2, count - offset),
        "short page",
      );
      ensure(
        Boolean(object(page).exceededTransferLimit) === offset + 2 < count,
        "unexpected transfer-limit flag",
      );
    }
    await this.count(run, "after");
    await this.ids(run, "after", count);
  }
  private count(run: string, when: string) {
    return this.archive.request(
      run,
      `count-${when}`,
      queryUrl(configs.tnr.layer + "/query", {
        where: "1=1",
        returnCountOnly: "true",
      }),
      "json",
      (v) => integer(object(v).count, 1, 10),
    );
  }
  private ids(run: string, when: string, count: number) {
    return this.archive.request(
      run,
      `ids-${when}`,
      queryUrl(configs.tnr.layer + "/query", {
        where: "1=1",
        returnIdsOnly: "true",
        returnGeometry: "false",
      }),
      "json",
      (v) => authoritativeIds(v, count),
    );
  }
  private async published(
    run: string,
    itemValue: unknown,
    rules: Record<string, string>,
  ) {
    const item = validatePublishedItem(itemValue),
      entry = `${sharing}/content/items/${configs.voter.item}/data`;
    const cached = this.archive.store.observation(run, "published-file");
    if (!cached) {
      this.checkRoute(rules, entry);
      const url = publishedRedirect(
        await this.archive.request(run, "published-entry", entry, "redirect"),
      );
      this.checkRoute(rules, url);
      await this.archive.request(
        run,
        "published-file",
        url,
        "zip",
        async (value) => {
          ensure(value instanceof Uint8Array, "ZIP bytes missing");
          await validateZip(value, integer(item.size, 1, 1_000_000));
        },
      );
    }
    await this.archive.request(
      run,
      "item-after",
      itemUrl(configs.voter.item),
      "json",
      (v) => publishedStable(item, v),
    );
  }
  async verifyCollection(run: string, source: Source): Promise<unknown> {
    const read = (label: string) => this.archive.read(run, label);
    if (source === "voter") {
      const item = await read("item-before");
      publishedStable(item, await read("item-after"));
      const zip = await read("published-file");
      ensure(zip instanceof Uint8Array, "ZIP bytes missing");
      return {
        source,
        strategy: configs.voter.strategy,
        ...(await validateZip(zip, integer(object(item).size, 1, 1_000_000))),
        publicationDate: null,
        scope:
          "one published geographic ZIP; no service content/version equality claim",
      };
    }
    const layer = await read("layer"),
      before = await read("count-before"),
      count = integer(object(before).count, 1, 10),
      actual: number[] = [];
    for (let offset = 0; offset < count; offset += 2) {
      const page = await read(`page-${offset}`),
        ids = validateFeatures(page, layer);
      ensure(
        ids.length === Math.min(2, count - offset) &&
          Boolean(object(page).exceededTransferLimit) === offset + 2 < count,
        "page completeness changed",
      );
      actual.push(...ids);
    }
    const ids = reconcile(
      before,
      await read("ids-before"),
      actual,
      await read("count-after"),
      await read("ids-after"),
    );
    return {
      source,
      strategy: configs.tnr.strategy,
      records: ids.length,
      ids,
      spatialReference: object(object(layer).extent).spatialReference,
      catalogItem: configs.tnr.item,
      serviceItemId: object(await read("service")).serviceItemId ?? null,
      publicationDate: null,
      scope:
        "bounded full record/native geometry observation, five attributes; not transactional/history/topology proof",
    };
  }
  async verify() {
    const result = await this.archive.verify();
    const completed = this.archive.store.completed();
    for (const run of completed) {
      const summary = await this.verifyCollection(run.id, source(run.source));
      ensure(
        same(summary, JSON.parse(run.summary)),
        "stored summary differs from original content",
      );
    }
    return {
      ...result,
      collections: completed.length,
      status: this.archive.store.status(),
    };
  }
}
