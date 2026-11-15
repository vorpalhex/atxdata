import { mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { configs } from "../../src/sources";
import { terms } from "../../src/rules";
export async function policyFixture(
  options: { publishedURL?: string; id?: string; v1?: boolean } = {},
) {
  const base = await mkdtemp(join(process.env.TMPDIR!, "policy-native-")),
    root = join(base, "archive"),
    id = options.id ?? "d".repeat(32);
  const item = {
    id,
    title: "Policy fixture",
    type: "Web Mapping Application",
    access: "public",
    url: options.publishedURL ?? "https://maps.austintexas.gov/FloodPro/",
    licenseInfo: "item fixture terms",
  };
  const site = {
    ...item,
    id: configs.austin.site,
    licenseInfo: "catalog fixture terms",
  };
  const wire: { url: string; ua: boolean }[] = [];
  const mode = {
    routes: {} as Record<
      string,
      { body: Buffer; mime: string; status?: number }
    >,
    status: 301,
    location: "https://geohub.austintexas.gov/",
    body: Buffer.from("<html>GeoHub fixture</html>"),
    mime: "text/html",
    headers: {} as Record<string, string>,
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const u = new URL(req.url),
        parts = u.pathname.split("/"),
        host = parts[1],
        path = "/" + parts.slice(2).join("/");
      wire.push({
        url: "https://" + host + path + u.search,
        ua: req.headers.get("user-agent") === "atxdata-arcgis/0.1",
      });
      const custom = mode.routes["https://" + host + path + u.search];
      if (custom)
        return new Response(new Uint8Array(custom.body), {
          status: custom.status ?? 200,
          headers: {
            "content-type": custom.mime,
            "content-length": String(custom.body.length),
          },
        });
      if (host === "maps.austintexas.gov")
        return new Response(mode.body, {
          status: mode.status,
          headers: {
            "content-type": mode.mime,
            "content-length": String(mode.body.length),
            ...([301, 302].includes(mode.status)
              ? { location: mode.location }
              : {}),
            ...mode.headers,
          },
        });
      if (host === "geohub.austintexas.gov")
        return new Response(mode.body, {
          headers: {
            "content-type": mode.mime,
            "content-length": String(mode.body.length),
          },
        });
      if (host !== "www.arcgis.com") throw Error("unexpected fixture host");
      if (path === "/robots.txt")
        return new Response("User-agent: *\nAllow: /\n", {
          headers: { "content-type": "text/plain" },
        });
      if (path.endsWith("/search"))
        return Response.json({ total: 1, nextStart: -1, results: [item] });
      if (path.endsWith(site.id + "/data"))
        return Response.json({
          catalogV2: {
            scopes: {
              item: {
                filters: [{ predicates: [{ group: ["a".repeat(32)] }] }],
              },
            },
          },
        });
      if (path.endsWith(site.id)) return Response.json(site);
      if (path.endsWith(id + "/data"))
        return new Response("{}", {
          headers: {
            "content-type": "application/json",
            "content-length": "2",
          },
        });
      if (path.endsWith(id)) return Response.json(item);
      throw Error("unexpected fixture route");
    },
  });
  const preload = join(base, "fixture.ts"),
    deny = join(base, "deny.ts"),
    clock = join(base, "clock");
  await writeFile(
    preload,
    `import{existsSync,readFileSync,writeFileSync}from"node:fs";const c=${JSON.stringify(clock)};let now=existsSync(c)?Number(readFileSync(c,"utf8")):0;Date.now=()=>now;Bun.sleep=async(ms)=>{now+=Number(ms);writeFileSync(c,String(now))};const native=globalThis.fetch;globalThis.fetch=(url,init)=>{const u=new URL(String(url));if(!["www.arcgis.com","maps.austintexas.gov","geohub.austintexas.gov","austin.maps.arcgis.com","services.arcgis.com"].includes(u.hostname))throw Error("unexpected fixture authority");return native(${JSON.stringify(server.url.href)}+u.hostname+u.pathname+u.search,init)};process.on("exit",()=>Bun.gc(true));`,
  );
  await writeFile(
    deny,
    'globalThis.fetch=()=>{throw Error("OFFLINE HTTP FORBIDDEN")};process.on("exit",()=>Bun.gc(true));',
  );
  async function invoke(args: string[], offline = false) {
    const p = Bun.spawn(
      [
        process.execPath,
        "--preload",
        offline ? deny : preload,
        resolve(import.meta.dir, "../../src/cli.ts"),
        ...args,
      ],
      {
        env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [out, err, exit] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    return { out, err, exit };
  }
  async function produce() {
    const r = await invoke([
      "inspect-app",
      ...(options.v1 ? [] : ["--app-data-format", "json-or-empty-v2"]),
      "--source",
      "austin",
      "--item",
      id,
      "--archive",
      root,
      "--catalog-terms-sha256",
      terms(site).sha256,
      "--terms-sha256",
      terms(item).sha256,
      "--max-pages",
      "1",
      "--max-requests",
      "6",
    ]);
    if (r.exit !== 0) throw Error(r.err);
    const run = JSON.parse(r.out).run;
    const db = new Database(join(root, "state.sqlite"), { readonly: true });
    const row = db
      .query<{ sha256: string }, [string]>(
        "SELECT sha256 FROM observations WHERE run=? AND label='app-item'",
      )
      .get(run)!;
    db.close();
    return [
      "inspect-policy",
      "--source",
      "austin",
      "--item",
      id,
      "--archive",
      root,
      "--app-run",
      run,
      "--app-item-sha256",
      row.sha256,
    ];
  }
  return {
    base,
    root,
    id,
    mode,
    wire,
    invoke,
    produce,
    close: () => server.stop(true),
  };
}
