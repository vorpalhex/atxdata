export type Logger = {
  info: (event: string, data?: Record<string, unknown>) => void;
  warn: (event: string, data?: Record<string, unknown>) => void;
  error: (event: string, data?: Record<string, unknown>) => void;
};

export function createLogger(runId?: string): Logger {
  function write(level: "info" | "warn" | "error", event: string, data: Record<string, unknown> = {}) {
    console.log(
      JSON.stringify({
        ...data,
        ts: new Date().toISOString(),
        level,
        event,
        runId,
      }),
    );
  }

  return {
    info: (event, data) => write("info", event, data),
    warn: (event, data) => write("warn", event, data),
    error: (event, data) => write("error", event, data),
  };
}

export function makeRunId(prefix = "run"): string {
  return `${prefix}_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

