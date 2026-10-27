import { expect, test } from "bun:test";
import type { AppConfig } from "../../src/config";
import { LegistarApiClient, type ApiEvent, type ApiEventItem } from "../../src/legistar/api-client";
import type { HttpClient } from "../../src/util/http";

function client(data: unknown) {
  const urls: string[] = [];
  const http: HttpClient = { getJson: async <T>(url: string) => { urls.push(url); return data as T; }, fetchWithRetry: async () => { throw new Error("unexpected download"); } };
  return { api: new LegistarApiClient({ apiBase: "http://local/v1/", legistarClient: "city" } as AppConfig, http), urls };
}

test("event normalization preserves every field including zero and empty strings", async () => {
  const event: ApiEvent = { EventId: 7, EventGuid: "", EventBodyId: 0, EventBodyName: " Council ", EventDate: "2026-02-28T10:00:00", EventTime: "", EventLocation: "", EventAgendaStatusName: "draft", EventMinutesStatusName: "final", EventInSiteURL: "portal", EventAgendaFile: "agenda", EventAgendaPacketFile: "packet", EventMinutesFile: "minutes" };
  const { api, urls } = client(event);
  expect(await api.getEvent(7)).toEqual({ eventId: 7, eventGuid: "", bodyId: 0, bodyName: "Council", meetingDate: "2026-02-28", meetingTime: "", location: "", agendaStatus: "draft", minutesStatus: "final", portalUrl: "portal", agendaUrl: "agenda", agendaPacketUrl: "packet", minutesUrl: "minutes" });
  expect(urls).toEqual(["http://local/v1/city/Events/7"]);
});

test("absent and null event fields become null with explicit body and date fallbacks", async () => {
  const { api } = client({ EventId: 8, EventBodyName: "  ", EventAgendaFile: null });
  expect(await api.getEvent(8)).toEqual({ eventId: 8, eventGuid: null, bodyId: null, bodyName: "Unknown", meetingDate: "unknown-date", meetingTime: null, location: null, agendaStatus: null, minutesStatus: null, portalUrl: null, agendaUrl: null, agendaPacketUrl: null, minutesUrl: null });
  expect((await client({ EventId: 1, EventDate: "" }).api.getEvent(1)).meetingDate).toBe("");
});

test("items preserve every normalized field and raw attachments without treating falsy values as missing", async () => {
  const item: ApiEventItem = { EventItemId: 1, EventItemEventId: 7, EventItemGuid: "", EventItemAgendaSequence: 0, EventItemMinutesSequence: 0, EventItemAgendaNumber: "", EventItemTitle: "", EventItemMatterId: 0, EventItemMatterGuid: "", EventItemMatterFile: "", EventItemMatterName: "", EventItemMatterType: "", EventItemMatterStatus: "", EventItemMatterAttachments: [] };
  const { api, urls } = client([item, { EventItemId: 2, EventItemEventId: 7, EventItemTitle: null }]);
  expect(await api.getEventItems(7)).toEqual([
    { eventItemId: 1, eventId: 7, eventItemGuid: "", agendaSequence: 0, minutesSequence: 0, agendaNumber: "", title: "", matterId: 0, matterGuid: "", matterFile: "", matterName: "", matterType: "", matterStatus: "" },
    { eventItemId: 2, eventId: 7, eventItemGuid: null, agendaSequence: null, minutesSequence: null, agendaNumber: null, title: null, matterId: null, matterGuid: null, matterFile: null, matterName: null, matterType: null, matterStatus: null },
  ]);
  expect((await api.getRawEventItems(7))[0]).toEqual(item);
  expect(urls).toEqual(Array(2).fill("http://local/v1/city/Events/7/EventItems?AgendaNote=1&MinutesNote=1&Attachments=1"));
});

test("item normalization retains populated agenda and matter metadata", async () => {
  const { api } = client([{ EventItemId: 1, EventItemEventId: 2, EventItemGuid: "item-guid", EventItemAgendaSequence: 3, EventItemMinutesSequence: 4, EventItemAgendaNumber: "5", EventItemTitle: "Title", EventItemMatterId: 6, EventItemMatterGuid: "matter-guid", EventItemMatterFile: "26-001", EventItemMatterName: "Name", EventItemMatterType: "Resolution", EventItemMatterStatus: "Passed" }]);
  expect(await api.getEventItems(2)).toEqual([{ eventItemId: 1, eventId: 2, eventItemGuid: "item-guid", agendaSequence: 3, minutesSequence: 4, agendaNumber: "5", title: "Title", matterId: 6, matterGuid: "matter-guid", matterFile: "26-001", matterName: "Name", matterType: "Resolution", matterStatus: "Passed" }]);
});

test("meeting documents carry full metadata in agenda packet minutes order and omit empty urls", async () => {
  const { api } = client({ EventId: 7, EventAgendaFile: "a", EventAgendaPacketFile: "p", EventMinutesFile: "m" });
  const meeting = await api.getEvent(7);
  const common = { sourceType: "api", eventId: 7, eventItemId: null, matterId: null, matterFile: null, attachmentId: null, attachmentGuid: null, agendaNumber: null } as const;
  expect(api.buildMeetingDocuments(meeting)).toEqual([
    { ...common, kind: "agenda", title: "Agenda", sourceUrl: "a", required: true },
    { ...common, kind: "agenda_packet", title: "Agenda Packet", sourceUrl: "p", required: false },
    { ...common, kind: "minutes", title: "Minutes", sourceUrl: "m", required: false },
  ]);
  expect(api.buildMeetingDocuments({ ...meeting, agendaUrl: "", agendaPacketUrl: null, minutesUrl: null })).toEqual([]);
});

test("attachment manifests distinguish external hyperlinks from API files and omit missing matters", () => {
  const { api } = client([]);
  const item: ApiEventItem = { EventItemId: 3, EventItemEventId: 7, EventItemMatterId: 9, EventItemMatterFile: "", EventItemAgendaNumber: "", EventItemMatterAttachments: [
    { MatterAttachmentId: 1, MatterAttachmentName: "", MatterAttachmentGuid: "", MatterAttachmentIsHyperlink: true, MatterAttachmentHyperlink: "http://local/external" },
    { MatterAttachmentId: 2, MatterAttachmentIsHyperlink: true, MatterAttachmentHyperlink: "" },
    { MatterAttachmentId: 3, MatterAttachmentIsHyperlink: false, MatterAttachmentHyperlink: "ignored" },
  ] };
  const common = { kind: "matter_attachment", sourceType: "api", required: true, eventId: 7, eventItemId: 3, matterId: 9, matterFile: "", agendaNumber: "" } as const;
  expect(api.buildItemDocuments([item, { ...item, EventItemMatterId: null }, { ...item, EventItemMatterId: 0 }, { ...item, EventItemMatterAttachments: undefined }])).toEqual([
    { ...common, title: "", sourceUrl: "http://local/external", attachmentId: 1, attachmentGuid: "" },
    { ...common, title: "Attachment 2", sourceUrl: "http://local/v1/city/Matters/9/Attachments/2/File", attachmentId: 2, attachmentGuid: null },
    { ...common, title: "Attachment 3", sourceUrl: "http://local/v1/city/Matters/9/Attachments/3/File", attachmentId: 3, attachmentGuid: null },
  ]);
});

test("event publication preserves explicit empty statuses and URLs", async () => {
  const { api } = client({ EventId: 9, EventAgendaStatusName: "", EventMinutesStatusName: "", EventInSiteURL: "", EventAgendaFile: "", EventAgendaPacketFile: "", EventMinutesFile: "" });
  expect(await api.getEvent(9)).toMatchObject({ agendaStatus: "", minutesStatus: "", portalUrl: "", agendaUrl: "", agendaPacketUrl: "", minutesUrl: "" });
});

test("event listing uses inclusive leap-day end and case insensitive trimmed body matching", async () => {
  const { api, urls } = client([{ EventId: 1, EventBodyName: " Council " }, { EventId: 2 }]);
  expect((await api.listEvents("2024-02-28", "2024-02-29", " COUNCIL ")).map((event) => event.eventId)).toEqual([1]);
  expect(decodeURIComponent(urls[0]!)).toBe("http://local/v1/city/Events?$filter=EventDate ge datetime'2024-02-28' and EventDate lt datetime'2024-03-01'&$orderby=EventDate asc");
  expect(await api.listEvents("2024-02-28", "2024-02-29", " ")).toHaveLength(2);
});
