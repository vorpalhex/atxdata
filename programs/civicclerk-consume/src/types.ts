export type PublishedFile = { fileId: number; fileType: number; type: string; name: string };
export type CivicEvent = { id: number; eventName: string; eventDate: string; publishedFiles: PublishedFile[] };
