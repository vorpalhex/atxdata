import { appendFileSync } from "node:fs";

// Observation only: do not install an uncaughtException handler or suppress exit.
process.on("uncaughtExceptionMonitor", (error, origin) => {
  appendFileSync(
    process.env.CLI_UNCAUGHT_LEDGER!,
    JSON.stringify({ origin, message: error.message, stack: error.stack }) +
      "\n",
  );
});
if (process.env.CLI_MONITOR_CALIBRATE) {
  queueMicrotask(() => {
    throw new Error("stderr monitor positive calibration");
  });
}
