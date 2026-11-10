import { appendFileSync } from "node:fs";
// In-memory fixture. The test runner must also deny public networking at OS level.
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input));
  if (url.hostname !== "fixture.invalid")
    throw new Error("unexpected fixture target");
  if (process.env.CLI_FIXTURE_CALLS)
    appendFileSync(process.env.CLI_FIXTURE_CALLS, url.pathname + "\n");
  const event = {
    EventId: 59,
    EventDate: "2021-01-05T00:00:00",
    EventBodyName: "City Council",
    EventTime: "9:00 AM",
    EventLocation: process.env.CLI_FIXTURE_LARGE
      ? "x".repeat(512 * 1024)
      : "Fixture",
  };
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
