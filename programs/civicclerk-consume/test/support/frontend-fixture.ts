import { appendFileSync } from "node:fs";
// In-memory transport; run with OS public networking denied.
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input));
  if (url.hostname !== "fixture.invalid")
    throw new Error("unexpected fixture target");
  if (process.env.CLI_FIXTURE_CALLS)
    appendFileSync(process.env.CLI_FIXTURE_CALLS, url.pathname + "\n");
  const event = {
    id: 59,
    eventName: process.env.CLI_FIXTURE_LARGE
      ? "x".repeat(512 * 1024)
      : "Fixture",
    eventDate: "2021-01-05T00:00:00Z",
    publishedFiles: [],
  };
  return Response.json(
    url.pathname.endsWith("/59") ? event : { value: [event] },
  );
}) as typeof fetch;
