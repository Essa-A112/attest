import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type { EvidencePack } from "./collect";

/** CSV of per-trainee outcomes. Pseudonyms only — no PII, ever. */
export function buildEvidenceCsv(pack: EvidencePack): string {
  const header = [
    "trainee_pseudonym",
    "assigned_at",
    "due_at",
    "attempts",
    "best_score",
    "total",
    "passed",
    "completed_at",
    "last_row_hash",
  ];
  const lines = pack.outcomes.map((o) =>
    [
      o.pseudonym,
      o.assignedAt,
      o.dueAt ?? "",
      String(o.attemptCount),
      o.bestScore === null ? "" : String(o.bestScore),
      o.total === null ? "" : String(o.total),
      o.passed ? "true" : "false",
      o.completedAt ?? "",
      o.lastRowHash ?? "",
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n") + "\n";
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

const PAGE = { width: 595, height: 842, margin: 56 } as const;

class PdfWriter {
  page!: PDFPage;
  y = 0;
  constructor(
    private readonly doc: PDFDocument,
    private readonly font: PDFFont,
    private readonly bold: PDFFont,
  ) {
    this.addPage();
  }

  addPage() {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - PAGE.margin;
  }

  ensure(space: number) {
    if (this.y - space < PAGE.margin) this.addPage();
  }

  text(text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number] } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const maxWidth = PAGE.width - PAGE.margin * 2;
    for (const paragraph of text.split("\n")) {
      const lines = wrap(paragraph, font, size, maxWidth);
      for (const line of lines) {
        this.ensure(size + 4);
        this.page.drawText(line, {
          x: PAGE.margin,
          y: this.y - size,
          size,
          font,
        });
        this.y -= size + 4;
      }
    }
  }

  gap(px = 10) {
    this.ensure(px);
    this.y -= px;
  }

  rule() {
    this.ensure(12);
    this.page.drawLine({
      start: { x: PAGE.margin, y: this.y - 4 },
      end: { x: PAGE.width - PAGE.margin, y: this.y - 4 },
      thickness: 0.5,
    });
    this.y -= 12;
  }
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const clean = text.replaceAll(/[\r\t]/g, " ");
  const words = clean.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      // hard-break very long tokens (hashes)
      let token = word;
      while (font.widthOfTextAtSize(token, size) > maxWidth) {
        let i = token.length;
        while (i > 1 && font.widthOfTextAtSize(token.slice(0, i), size) > maxWidth) i--;
        lines.push(token.slice(0, i));
        token = token.slice(i);
      }
      current = token;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

/** Renders the evidence pack as a PDF. */
export async function buildEvidencePdf(pack: EvidencePack): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new PdfWriter(doc, font, bold);

  w.text("Attest Evidence Pack", { size: 20, bold: true });
  w.gap(4);
  w.text(`${pack.org.name} - ${pack.policy.title} (version ${pack.policy.version})`, { size: 12 });
  w.text(`Generated ${pack.generatedAt}`, { size: 9 });
  w.gap(6);
  w.text(
    "This pack supports an audit trail of policy training. It does not guarantee compliance and is not legal advice.",
    { size: 8 },
  );
  w.rule();

  w.text("1. Policy integrity", { size: 13, bold: true });
  w.gap(2);
  w.text(`Title: ${pack.policy.title}`);
  w.text(`Version: ${pack.policy.version} (a changed policy is always a new version)`);
  w.text(`Source: ${pack.policy.sourceKind}, stored ${pack.policy.storedAt}`);
  w.text(`SHA-256 of policy text: ${pack.policy.sha256}`);
  w.text(`Course pass mark: ${pack.course.passMark}%`);
  w.rule();

  w.text("2. Ledger chain verification", { size: 13, bold: true });
  w.gap(2);
  if (pack.chain.status === "intact") {
    w.text(
      `Result: INTACT. ${pack.chain.rows} attempt record(s) verified against the org's hash chain at generation time.`,
    );
  } else {
    w.text(
      `Result: BROKEN at row ${pack.chain.atSeq} of ${pack.chain.rows}: ${pack.chain.reason}`,
      { bold: true },
    );
  }
  w.text(
    "Each attempt row's hash is SHA-256 over the previous row's hash plus a canonical serialisation of the row. Any alteration of a stored attempt breaks every later link.",
    { size: 8 },
  );
  w.rule();

  w.text("3. Approved question set", { size: 13, bold: true });
  w.text(
    "Every question below was approved or edited by an administrator before any trainee saw it.",
    { size: 8 },
  );
  w.gap(4);
  pack.questions.forEach((q, i) => {
    w.ensure(80);
    w.text(`Q${i + 1} [${q.reviewStatus}]`, { bold: true });
    w.text(q.scenario);
    q.options.forEach((opt, j) => {
      w.text(`   ${j === q.correct ? "*" : " "} ${String.fromCharCode(65 + j)}. ${opt}${j === q.correct ? "  (correct)" : ""}`, {
        size: 9,
      });
    });
    w.text(`Rationale: ${q.rationale}`, { size: 9 });
    w.text(`Policy clause: "${q.sourceQuote}"`, { size: 8 });
    w.gap(8);
  });
  w.rule();

  w.text("4. Per-trainee outcomes", { size: 13, bold: true });
  w.text(
    "Trainees are identified by pseudonym. The pseudonym-to-identity mapping is held separately by the organisation and can be erased under GDPR without touching this ledger; records then refer to 'a trainee' rather than a person, and the chain remains verifiable.",
    { size: 8 },
  );
  w.gap(4);
  if (pack.outcomes.length === 0) {
    w.text("No assignments.");
  }
  for (const o of pack.outcomes) {
    w.ensure(60);
    w.text(o.pseudonym, { bold: true });
    w.text(
      `Assigned ${o.assignedAt}${o.dueAt ? `, due ${o.dueAt}` : ""} - attempts: ${o.attemptCount}, best score: ${
        o.bestScore === null ? "-" : `${o.bestScore}/${o.total}`
      }, passed: ${o.passed ? "yes" : "no"}${o.completedAt ? `, completed ${o.completedAt}` : ""}`,
      { size: 9 },
    );
    if (o.lastRowHash) w.text(`Latest ledger row hash: ${o.lastRowHash}`, { size: 8 });
    w.gap(6);
  }

  return doc.save();
}
