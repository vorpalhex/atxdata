import type { AppConfig } from "../config";
import { calendarRange, listingState, positiveLimit, type EventListingOptions, type EventContinuation } from "./listing";
export type { EventListingOptions, EventContinuation } from "./listing";
import type { DocumentManifestEntry, NormalizedItem, NormalizedMeeting } from "../types";
import type { HttpClient } from "../util/http";

export type ApiEvent = {
  EventId: number;
  EventGuid?: string;
  EventBodyId?: number;
  EventBodyName?: string;
  EventDate?: string;
  EventTime?: string;
  EventAgendaStatusName?: string;
  EventMinutesStatusName?: string;
  EventLocation?: string;
  EventAgendaFile?: string | null;
  EventAgendaPacketFile?: string | null;
  EventMinutesFile?: string | null;
  EventInSiteURL?: string | null;
};

export type ApiAttachment = {
  MatterAttachmentId: number;
  MatterAttachmentGuid?: string;
  MatterAttachmentName?: string;
  MatterAttachmentHyperlink?: string | null;
  MatterAttachmentIsHyperlink?: boolean;
};

export type ApiEventItem = {
  EventItemId: number;
  EventItemGuid?: string;
  EventItemEventId: number;
  EventItemAgendaSequence?: number | null;
  EventItemMinutesSequence?: number | null;
  EventItemAgendaNumber?: string | null;
  EventItemTitle?: string | null;
  EventItemAgendaNote?: string | null;
  EventItemMinutesNote?: string | null;
  EventItemMatterId?: number | null;
  EventItemMatterGuid?: string | null;
  EventItemMatterFile?: string | null;
  EventItemMatterName?: string | null;
  EventItemMatterType?: string | null;
  EventItemMatterStatus?: string | null;
  EventItemMatterAttachments?: ApiAttachment[];
};

export class LegistarApiClient {
  constructor(
    private readonly config: AppConfig,
    private readonly http: HttpClient,
  ) {}

  async listEvents(from: string, to: string, bodyName?: string, options: Pick<EventListingOptions,"maxPages" | "pageSize"> = {}): Promise<NormalizedMeeting[]> {
    const result = await this.listEventsPage(from, to, bodyName, {maxPages:options.maxPages,pageSize:options.pageSize});
    if (!result.complete) throw new Error("incomplete event range; raise maxPages or use listEventsPage continuation");
    return result.meetings.sort((a,b)=>a.meetingDate === "unknown-date" || b.meetingDate === "unknown-date" ? 0 : a.meetingDate.localeCompare(b.meetingDate));
  }

  validateListing(from: string, to: string, bodyName?: string, options: EventListingOptions = {}): void {
    this.listingRequest(from,to,bodyName,options);
  }
  private listingRequest(from: string, to: string, bodyName: string | undefined, options: EventListingOptions) {
    const end = calendarRange(from,to);
    const pageSize = positiveLimit(options.pageSize, 100);
    const maxPages = positiveLimit(options.maxPages, 100);
    const body = bodyName?.trim().toLowerCase() ?? "";
    const url = new URL(this.apiUrl("/Events"));
    url.searchParams.set("$filter", `EventDate ge datetime'${from}' and EventDate lt datetime'${end}'`);
    url.searchParams.set("$orderby", "EventId asc");
    url.searchParams.set("$top", String(pageSize));
    const query = JSON.stringify([url.href,body]);
    const state = listingState(query,pageSize,options.continuation);
    return {url,state,body,maxPages,pageSize};
  }
  async listEventsPage(from: string, to: string, bodyName?: string, options: EventListingOptions = {}): Promise<{ meetings: NormalizedMeeting[]; complete: boolean; continuation?: EventContinuation }> {
    const {url,state,body,maxPages,pageSize}=this.listingRequest(from,to,bodyName,options);
    const query=JSON.stringify([url.href,body]);
    const meetings: NormalizedMeeting[] = [];
    for (let page=0; page<maxPages; page++) {
      url.searchParams.set("$skip",String(state.offset));
      const events = await this.http.getJson<ApiEvent[]>(url.href);
      if (!Array.isArray(events) || events.length>pageSize) throw new Error("invalid event collection page");
      if (!events.length) return {meetings,complete:true};
      for (const meeting of this.normalizePage(events,state.ids,from,to,body)) meetings.push(meeting);
      state.offset+=events.length;
    }
    return {meetings,complete:false,continuation:{version:1,query,pageSize,offset:state.offset,ids:[...state.ids]}};
  }

  private normalizePage(events: ApiEvent[], ids: Set<number>, from: string, to: string, body: string): NormalizedMeeting[] {
    const meetings: NormalizedMeeting[] = [];
    for (const event of events) {
      validateListedEvent(event,ids,from,to);
      ids.add(event.EventId);
      const meeting = this.normalizeEvent(event);
      if (!body || meeting.bodyName.toLowerCase() === body) meetings.push(meeting);
    }
    return meetings;
  }

  async getEvent(eventId: number): Promise<NormalizedMeeting> {
    const event = await this.http.getJson<ApiEvent>(this.apiUrl(`/Events/${eventId}`));
    return this.normalizeEvent(event);
  }

  async getEventItems(eventId: number): Promise<NormalizedItem[]> {
    const url = this.apiUrl(`/Events/${eventId}/EventItems?AgendaNote=1&MinutesNote=1&Attachments=1`);
    const items = await this.http.getJson<ApiEventItem[]>(url);
    return items.map(normalizeItem);
  }

  async getRawEventItems(eventId: number): Promise<ApiEventItem[]> {
    const url = this.apiUrl(`/Events/${eventId}/EventItems?AgendaNote=1&MinutesNote=1&Attachments=1`);
    return await this.http.getJson<ApiEventItem[]>(url);
  }

  buildMeetingDocuments(meeting: NormalizedMeeting): DocumentManifestEntry[] {
    const documents = [
      { kind: "agenda", title: "Agenda", sourceUrl: meeting.agendaUrl, required: true },
      { kind: "agenda_packet", title: "Agenda Packet", sourceUrl: meeting.agendaPacketUrl, required: false },
      { kind: "minutes", title: "Minutes", sourceUrl: meeting.minutesUrl, required: false },
    ] as const;
    return documents.flatMap((document) => document.sourceUrl ? [{
      ...document,
      sourceUrl: document.sourceUrl,
      sourceType: "api" as const,
      eventId: meeting.eventId,
      eventItemId: null,
      matterId: null,
      matterFile: null,
      attachmentId: null,
      attachmentGuid: null,
      agendaNumber: null,
    }] : []);
  }

  buildItemDocuments(items: ApiEventItem[]): DocumentManifestEntry[] {
    return items.flatMap((item) => {
      const matterId = item.EventItemMatterId;
      if (!matterId) return [];
      return (item.EventItemMatterAttachments ?? []).map((attachment) =>
        this.buildAttachmentDocument(item, attachment, matterId));
    });
  }

  private buildAttachmentDocument(item: ApiEventItem, attachment: ApiAttachment, matterId: number): DocumentManifestEntry {
    const sourceUrl = attachment.MatterAttachmentIsHyperlink && attachment.MatterAttachmentHyperlink
      ? attachment.MatterAttachmentHyperlink
      : this.apiUrl(`/Matters/${matterId}/Attachments/${attachment.MatterAttachmentId}/File`);
    return {
      kind: "matter_attachment",
      title: attachment.MatterAttachmentName ?? `Attachment ${attachment.MatterAttachmentId}`,
      sourceUrl,
      sourceType: "api",
      required: true,
      eventId: item.EventItemEventId,
      eventItemId: item.EventItemId,
      matterId,
      matterFile: item.EventItemMatterFile ?? null,
      attachmentId: attachment.MatterAttachmentId,
      attachmentGuid: attachment.MatterAttachmentGuid ?? null,
      agendaNumber: item.EventItemAgendaNumber ?? null,
    };
  }

  private apiUrl(path: string): string {
    return `${this.config.apiBase.replace(/\/$/, "")}/${this.config.legistarClient}${path}`;
  }

  private normalizeEvent(event: ApiEvent): NormalizedMeeting {
    return { ...eventIdentity(event), ...eventSchedule(event), ...eventPublication(event) };
  }
}

function validateListedEvent(event: ApiEvent, ids: Set<number>, from: string, to: string): void {
  if (!Number.isSafeInteger(event.EventId) || event.EventId <= 0 || ids.has(event.EventId)) throw new Error("duplicate or invalid event ID; collection paging did not advance");
  if (event.EventDate && (event.EventDate.slice(0,10) < from || event.EventDate.slice(0,10) > to)) throw new Error("event outside requested range");
}

function eventIdentity(event: ApiEvent) {
  return {
    eventId: event.EventId,
    eventGuid: event.EventGuid ?? null,
    bodyId: event.EventBodyId ?? null,
    bodyName: event.EventBodyName?.trim() || "Unknown",
  };
}

function eventSchedule(event: ApiEvent) {
  return {
    meetingDate: event.EventDate?.slice(0, 10) ?? "unknown-date",
    meetingTime: event.EventTime ?? null,
    location: event.EventLocation ?? null,
  };
}

function eventPublication(event: ApiEvent) {
  return {
    agendaStatus: event.EventAgendaStatusName ?? null,
    minutesStatus: event.EventMinutesStatusName ?? null,
    portalUrl: event.EventInSiteURL ?? null,
    agendaUrl: event.EventAgendaFile ?? null,
    agendaPacketUrl: event.EventAgendaPacketFile ?? null,
    minutesUrl: event.EventMinutesFile ?? null,
  };
}

/** Shared API-boundary normalization for listing and ingestion. */
export function normalizeItem(item: ApiEventItem): NormalizedItem {
  return { ...itemAgenda(item), ...itemMatter(item) };
}

function itemAgenda(item: ApiEventItem) {
  return {
    eventItemId: item.EventItemId,
    eventItemGuid: item.EventItemGuid ?? null,
    eventId: item.EventItemEventId,
    agendaSequence: item.EventItemAgendaSequence ?? null,
    minutesSequence: item.EventItemMinutesSequence ?? null,
    agendaNumber: item.EventItemAgendaNumber ?? null,
    title: item.EventItemTitle ?? null,
    ...(item.EventItemAgendaNote !== undefined ? { agendaNote: item.EventItemAgendaNote } : {}),
    ...(item.EventItemMinutesNote !== undefined ? { minutesNote: item.EventItemMinutesNote } : {}),
  };
}

function itemMatter(item: ApiEventItem) {
  return {
    matterId: item.EventItemMatterId ?? null,
    matterGuid: item.EventItemMatterGuid ?? null,
    matterFile: item.EventItemMatterFile ?? null,
    matterName: item.EventItemMatterName ?? null,
    matterType: item.EventItemMatterType ?? null,
    matterStatus: item.EventItemMatterStatus ?? null,
  };
}
