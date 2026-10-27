import type { AppConfig } from "../config";
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

  async listEvents(from: string, to: string, bodyName?: string): Promise<NormalizedMeeting[]> {
    const filter = `EventDate ge datetime'${from}' and EventDate lt datetime'${addOneDay(to)}'`;
    const url = this.apiUrl(`/Events?$filter=${encodeURIComponent(filter)}&$orderby=EventDate asc`);
    const events = await this.http.getJson<ApiEvent[]>(url);
    const normalizedBodyName = bodyName?.trim().toLowerCase();
    return events
      .map((event) => this.normalizeEvent(event))
      .filter((event) => !normalizedBodyName || event.bodyName.toLowerCase() === normalizedBodyName);
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

function addOneDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}
