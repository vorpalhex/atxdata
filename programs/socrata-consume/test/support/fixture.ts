import { origin, catalogOrigin } from "../../src/source";
export function fixture(
  asset = "8c6z-qnmj",
  size = 3,
  filter: string | null = "fiscal_year = '2025'",
) {
  let time = 1800000000000,
    calls: string[] = [],
    failOffset: number | undefined,
    version = 1;
  const rows = Array.from({ length: size }, (_, i) => ({
    ":id": `row-${i + 1}`,
    amount: i === 0 ? "9007199254740993.00" : `${i + 1}.00`,
  }));
  const deps = {
    clockDomain: "fixture-epoch-ms",
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
    fetch: async (input: string) => {
      calls.push(input);
      const url = new URL(input),
        path = url.pathname;
      if (path === "/robots.txt")
        return new Response(
          "User-agent: *\nDisallow: /browse\nCrawl-delay: 3\n",
        );
      if (url.origin === catalogOrigin)
        return Response.json({
          results: [
            {
              resource: { id: asset, name: "Payments", type: "dataset" },
              metadata: { domain: "data.austintexas.gov" },
              link: origin + "/d/" + asset,
            },
          ],
          resultSetSize: 1,
        });
      if (path.startsWith("/api/views"))
        return Response.json({
          id: asset,
          name: "Payments",
          viewType: "tabular",
          rowsUpdatedAt: version,
          columns: [{ fieldName: "amount", dataTypeName: "number" }],
        });
      if (url.searchParams.get("$where") !== filter)
        throw Error("fixture where mismatch");
      if (url.searchParams.get("$select") === "count(*)")
        return Response.json([{ count: String(rows.length) }]);
      if (
        url.searchParams.get("$select") !== "*, :id" ||
        url.searchParams.get("$order") !== ":id"
      )
        throw Error("fixture SoQL syntax mismatch");
      const offset = Number(url.searchParams.get("$offset"));
      if (offset === failOffset) {
        failOffset = undefined;
        return new Response("busy", {
          status: 429,
          headers: { "Retry-After": "20" },
        });
      }
      return Response.json(
        rows.slice(offset, offset + Number(url.searchParams.get("$limit"))),
      );
    },
  };
  return {
    deps,
    calls,
    rows,
    fail: (offset: number) => {
      failOffset = offset;
    },
    change: () => {
      version++;
    },
  };
}
