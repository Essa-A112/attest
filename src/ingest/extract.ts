export type SourceKind = "pdf" | "docx" | "text";

export interface ExtractedDocument {
  text: string;
  kind: SourceKind;
}

/**
 * Normalises extracted text so downstream character offsets are stable:
 * CRLF -> LF, strips trailing whitespace per line, collapses 3+ blank lines.
 * The result is the canonical policy text that gets hashed and quoted against.
 */
export function normalizeText(raw: string): string {
  return raw
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function detectKind(filename: string, contentType: string | null): SourceKind {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf") || contentType === "application/pdf") return "pdf";
  if (
    lower.endsWith(".docx") ||
    contentType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  return "text";
}

export async function extractFromPdf(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  // pdf.js detaches the buffer it is given; pass a copy so callers can still
  // use (e.g. store) the original bytes afterwards.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return normalizeText(text);
}

export async function extractFromDocx(bytes: Uint8Array): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.extractRawText({
    buffer: Buffer.from(bytes),
  });
  return normalizeText(value);
}

export async function extractDocument(
  bytes: Uint8Array,
  kind: SourceKind,
): Promise<ExtractedDocument> {
  switch (kind) {
    case "pdf":
      return { text: await extractFromPdf(bytes), kind };
    case "docx":
      return { text: await extractFromDocx(bytes), kind };
    case "text":
      return { text: normalizeText(new TextDecoder().decode(bytes)), kind };
  }
}
