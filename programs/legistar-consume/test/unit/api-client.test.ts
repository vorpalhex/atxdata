import { expect, test } from "bun:test";
import type { AppConfig } from "../../src/config";
import { LegistarApiClient, type ApiEvent } from "../../src/legistar/api-client";
import type { HttpClient } from "../../src/util/http";

const config: AppConfig = {
  legistarClient: "austintexas",
  apiBase: "https://webapi.legistar.com/v1",
  portalBase: "https://austintexas.legistar.com",
  databasePath: "test-output/legistar.sqlite",
  documentStorePath: "test-output/documents",
  runsPath: "test-output/runs",
  userAgent: "test",
  httpTimeoutMs: 1_000,
  downloadConcurrencyNormal: 3,
  downloadConcurrencyBackfill: 1,
  backfillMeetingDelayMs: 0,
  maxDownloadRetries: 0,
};

test("listEvents returns all bodies when no body filter is provided", async () => {
  const http = fakeHttp([
    event(4188, "Public Safety Committee"),
    event(4186, "Housing and Planning Committee  "),
  ]);
  const api = new LegistarApiClient(config, http);

  const meetings = await api.listEvents("2026-05-30", "2026-08-01");

  expect(meetings.map((meeting) => meeting.bodyName)).toEqual([
    "Public Safety Committee",
    "Housing and Planning Committee",
  ]);
  expect(decodeURIComponent(http.urls[0]!)).toContain("EventDate lt datetime'2026-08-02'");
});

test("listEvents trims body names before filtering", async () => {
  const api = new LegistarApiClient(config, fakeHttp([event(4186, "Housing and Planning Committee  ")]));

  const meetings = await api.listEvents("2026-05-30", "2026-08-01", "Housing and Planning Committee");

  expect(meetings).toHaveLength(1);
  expect(meetings[0]?.eventId).toBe(4186);
});

function fakeHttp(events: ApiEvent[]): HttpClient & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    getJson: async <T>(url: string) => {
      urls.push(url);
      return events as T;
    },
    fetchWithRetry: async () => {
      throw new Error("not implemented");
    },
  };
}

function event(EventId: number, EventBodyName: string): ApiEvent {
  return {
    EventId,
    EventBodyName,
    EventDate: "2026-06-01T00:00:00",
  };
}
