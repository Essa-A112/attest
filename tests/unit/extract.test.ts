import { describe, expect, it } from "vitest";
import { detectKind, extractDocument, normalizeText } from "@/ingest/extract";
import { makeDocx, makePdf } from "../helpers/fixtures";

describe("normalizeText", () => {
  it("normalises newlines, trailing whitespace, and blank-line runs", () => {
    const input = "Line one.  \r\nLine two.\r\r\n\n\n\nLine three.\n";
    expect(normalizeText(input)).toBe("Line one.\nLine two.\n\nLine three.");
  });
});

describe("detectKind", () => {
  it("detects by extension and content type", () => {
    expect(detectKind("policy.pdf", null)).toBe("pdf");
    expect(detectKind("upload.bin", "application/pdf")).toBe("pdf");
    expect(detectKind("policy.docx", null)).toBe("docx");
    expect(detectKind("notes.txt", "text/plain")).toBe("text");
  });
});

describe("extractDocument", () => {
  it("extracts text from a real PDF", async () => {
    const pdf = await makePdf([
      "Data Handling Policy",
      "Staff must lock their screens when leaving a desk.",
    ]);
    const { text } = await extractDocument(pdf, "pdf");
    expect(text).toContain("Data Handling Policy");
    expect(text).toContain("lock their screens");
  });

  it("extracts text from a real docx", async () => {
    const docx = await makeDocx([
      "Expenses Policy",
      "Claims must be submitted within 30 days.",
    ]);
    const { text } = await extractDocument(docx, "docx");
    expect(text).toContain("Expenses Policy");
    expect(text).toContain("within 30 days");
  });

  it("decodes plain text", async () => {
    const bytes = new TextEncoder().encode("Just some text.\r\n");
    const { text } = await extractDocument(bytes, "text");
    expect(text).toBe("Just some text.");
  });
});
