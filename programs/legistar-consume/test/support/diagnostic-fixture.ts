import { appendFileSync, writeFileSync } from "node:fs";
let active = 0, peak = 0;
process.on("exit", () => { if (process.env.CLI_FIXTURE_STATS) writeFileSync(process.env.CLI_FIXTURE_STATS, String(peak)); });
globalThis.fetch = (async () => {
  appendFileSync(process.env.CLI_FIXTURE_CALLS!, "fixture\n");
  active++; peak = Math.max(peak, active);
  await new Promise(resolve => setTimeout(resolve, process.env.CLI_FIXTURE_DELAY ? 30000 : 5));
  active--;
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
}) as unknown as typeof fetch;
