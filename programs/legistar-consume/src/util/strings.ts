export function sanitizeSegment(input: string | null | undefined, fallback = "untitled"): string {
  return cleanSegment(input ?? "") || cleanSegment(fallback) || "untitled";
}

function cleanSegment(input: string): string {
  const cleaned = input
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 120);

  return /^\.+$/.test(cleaned) ? "" : cleaned;
}

const contentTypeExtensions = new Map([
  ["application/pdf", ".pdf"],
  ["application/msword", ".doc"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"],
  ["application/vnd.ms-excel", ".xls"],
  ["text/html", ".html"],
  ["text/plain", ".txt"],
]);

export function extensionFromContentType(contentType: string | null): string {
  const mediaType = (contentType ?? "").split(";", 1)[0]!.trim().toLowerCase();
  return contentTypeExtensions.get(mediaType) ?? "";
}

