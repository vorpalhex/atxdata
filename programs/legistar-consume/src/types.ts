export type IngestMode = "meeting" | "backfill" | "retry";

export type NormalizedMeeting = {
  eventId: number;
  eventGuid: string | null;
  bodyId: number | null;
  bodyName: string;
  meetingDate: string;
  meetingTime: string | null;
  location: string | null;
  agendaStatus: string | null;
  minutesStatus: string | null;
  portalUrl: string | null;
  agendaUrl: string | null;
  agendaPacketUrl: string | null;
  minutesUrl: string | null;
};

export type NormalizedItem = {
  eventItemId: number;
  eventItemGuid: string | null;
  eventId: number;
  agendaSequence: number | null;
  minutesSequence: number | null;
  agendaNumber: string | null;
  title: string | null;
  matterId: number | null;
  matterGuid: string | null;
  matterFile: string | null;
  matterName: string | null;
  matterType: string | null;
  matterStatus: string | null;
};

export type DocumentKind = "agenda" | "agenda_packet" | "minutes" | "matter_attachment";

export type DocumentManifestEntry = {
  kind: DocumentKind;
  title: string;
  sourceUrl: string;
  sourceType: "api" | "scrape";
  required: boolean;
  eventId: number;
  eventItemId: number | null;
  matterId: number | null;
  matterFile: string | null;
  attachmentId: number | null;
  attachmentGuid: string | null;
  agendaNumber: string | null;
};

export type RunSummary = {
  runId: string;
  mode: IngestMode;
  status: "running" | "succeeded" | "failed";
  meetingsDiscovered: number;
  meetingsProcessed: number;
  documentsDiscovered: number;
  documentsDownloaded: number;
  documentsSkipped: number;
  documentsFailed: number;
  totalBytes: number;
  outputDirectory: string;
  startedAt: string;
  finishedAt?: string;
  failures: Array<{ url: string; title: string; error: string }>;
};

