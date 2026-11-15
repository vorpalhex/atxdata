import { appendFileSync } from "node:fs";
// In-memory fixture. The test runner must also deny public networking at OS level.
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input));
  if (url.hostname !== "fixture.invalid")
    throw new Error("unexpected fixture target");
  if (process.env.CLI_FIXTURE_CALLS)
    appendFileSync(process.env.CLI_FIXTURE_CALLS, url.pathname + "\n");
  if (process.env.CLI_FIXTURE_QUERIES)
    appendFileSync(
      process.env.CLI_FIXTURE_QUERIES,
      url.searchParams.get("$filter") + "\n",
    );
  const event = {
    EventId: 59,
    EventDate: process.env.CLI_FIXTURE_DATE_FROM_QUERY
      ? (url.searchParams
          .get("$filter")
          ?.match(/datetime'(\d{4}-\d{2}-\d{2})'/)?.[1] ?? "2021-01-05") +
        "T00:00:00"
      : "2021-01-05T00:00:00",
    EventBodyName: "City Council",
    EventTime: process.env.CLI_FIXTURE_EMPTY_FIELDS ? "" : "9:00 AM",
    ...(process.env.CLI_FIXTURE_EMPTY_FIELDS
      ? { EventAgendaStatusName: "", EventMinutesStatusName: "" }
      : {}),
    EventLocation: process.env.CLI_FIXTURE_EMPTY_FIELDS
      ? ""
      : process.env.CLI_FIXTURE_LARGE
        ? "x".repeat(512 * 1024)
        : "Fixture",
  };
  if (process.env.CLI_FIXTURE_FAIL) return Response.json({}, { status: 404 });
  if (process.env.CLI_FIXTURE_EMPTY) return Response.json([]);
  return Response.json(
    url.pathname.endsWith("/EventItems")
      ? []
      : url.pathname.endsWith("/59")
        ? event
        : url.searchParams.get("$skip") === "0"
          ? [event]
          : [],
  );
}) as typeof fetch;
