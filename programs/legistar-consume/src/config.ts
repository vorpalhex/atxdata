import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type AppConfig = {
  legistarClient: string;
  apiBase: string;
  portalBase: string;
  databasePath: string;
  documentStorePath: string;
  runsPath: string;
  userAgent: string;
  httpTimeoutMs: number;
  downloadConcurrencyNormal: number;
  downloadConcurrencyBackfill: number;
  backfillMeetingDelayMs: number;
  maxDownloadRetries: number;
};

const firefoxUserAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0";

function setting<T>(override: T | undefined, name: string, fallback: T): T | string {
  return override ?? process.env[name] ?? fallback;
}

function numericSetting(name: string, override: number | undefined, fallback: number, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const raw = setting(override, name, fallback);
  const value = typeof raw === "string" && raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function paths(overrides: Partial<AppConfig>) {
  const dataPath = resolve(process.env.DATA_PATH ?? "./data");
  return {
    databasePath: resolve(setting(overrides.databasePath, "DATABASE_PATH", `${dataPath}/legistar.sqlite`)),
    documentStorePath: resolve(setting(overrides.documentStorePath, "DOCUMENT_STORE_PATH", `${dataPath}/documents`)),
    runsPath: resolve(setting(overrides.runsPath, "RUNS_PATH", `${dataPath}/runs`)),
  };
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const config: AppConfig = {
    ...paths(overrides),
    legistarClient: setting(overrides.legistarClient, "LEGISTAR_CLIENT", "austintexas"),
    apiBase: setting(overrides.apiBase, "LEGISTAR_API_BASE", "https://webapi.legistar.com/v1"),
    portalBase: setting(overrides.portalBase, "LEGISTAR_PORTAL_BASE", "https://austintexas.legistar.com"),
    userAgent: setting(overrides.userAgent, "HTTP_USER_AGENT", firefoxUserAgent),
    httpTimeoutMs: numericSetting("HTTP_TIMEOUT_MS", overrides.httpTimeoutMs, 30_000, 1, 2_147_483_647),
    downloadConcurrencyNormal: numericSetting("DOWNLOAD_CONCURRENCY_NORMAL", overrides.downloadConcurrencyNormal, 3, 1),
    downloadConcurrencyBackfill: numericSetting("DOWNLOAD_CONCURRENCY_BACKFILL", overrides.downloadConcurrencyBackfill, 1, 1),
    backfillMeetingDelayMs: numericSetting("BACKFILL_MEETING_DELAY_MS", overrides.backfillMeetingDelayMs, 3_000, 0, 2_147_483_647),
    maxDownloadRetries: numericSetting("MAX_DOWNLOAD_RETRIES", overrides.maxDownloadRetries, 3, 0),
  };
  for (const path of [dirname(config.databasePath), config.documentStorePath, config.runsPath]) {
    mkdirSync(path, { recursive: true });
  }
  return config;
}
