import { z } from "zod";
import { llmConfig } from "./config";
import { fenceDocument, UNTRUSTED_DATA_RULES } from "./fence";
import type { CompletionResult, LlmProvider } from "./provider";

/** Obligation as extracted and verified against the policy text. */
export interface VerifiedObligation {
  id: string;
  statement: string;
  quote: string;
  offsets: [number, number];
}

export interface PassARun {
  input: unknown;
  output: unknown;
  modelVersion: string;
  latencyMs: number;
}

export interface PassAResult {
  obligations: VerifiedObligation[];
  /** One entry per model call (including retries), for generation_runs. */
  runs: PassARun[];
  /** Obligations the model returned that failed offset verification. */
  droppedCount: number;
}

const obligationSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  quote: z.string().min(1),
  start: z.int().nonnegative(),
  end: z.int().nonnegative(),
});

const passAOutputSchema = z.object({
  obligations: z.array(obligationSchema),
});

/** JSON schema sent to the API for structured output (mirrors the zod schema). */
const PASS_A_JSON_SCHEMA = {
  type: "object",
  properties: {
    obligations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          statement: { type: "string" },
          quote: { type: "string" },
          start: { type: "integer" },
          end: { type: "integer" },
        },
        required: ["id", "statement", "quote", "start", "end"],
        additionalProperties: false,
      },
    },
  },
  required: ["obligations"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You extract concrete obligations from a company policy document for compliance training.

${UNTRUSTED_DATA_RULES}

An obligation is a specific rule an employee must follow (or must not break): duties, limits, deadlines, prohibitions, required approvals. Skip preamble, definitions, and aspirational statements.

For each obligation return:
- id: "OB-1", "OB-2", ... in document order
- statement: the rule restated as one plain-English sentence
- quote: a VERBATIM substring of the document that grounds the obligation. Copy it character-for-character, including punctuation and line breaks.
- start, end: character offsets such that document.slice(start, end) === quote. Offsets are 0-based and measured against the exact document text between the boundary tags (not including the tags or the newline right after the opening tag / before the closing tag).

Extract every distinct obligation, typically 5 to 15 for a normal policy. Do not invent rules that are not in the document.`;

/**
 * Programmatic verification: a quote must equal policyText.slice(start, end).
 * If it does not but the quote occurs exactly once in the document, offsets are
 * repaired to that occurrence; otherwise the obligation is dropped.
 */
export function verifyObligations(
  policyText: string,
  raw: z.infer<typeof passAOutputSchema>,
): { verified: VerifiedObligation[]; dropped: number } {
  const verified: VerifiedObligation[] = [];
  let dropped = 0;
  const seenQuoteRanges = new Set<string>();

  for (const ob of raw.obligations) {
    let { start, end } = ob;
    if (policyText.slice(start, end) !== ob.quote) {
      const first = policyText.indexOf(ob.quote);
      const isUnique =
        first >= 0 && policyText.indexOf(ob.quote, first + 1) === -1;
      if (!isUnique) {
        dropped++;
        continue;
      }
      start = first;
      end = first + ob.quote.length;
    }
    const rangeKey = `${start}:${end}`;
    if (seenQuoteRanges.has(rangeKey)) {
      dropped++;
      continue;
    }
    seenQuoteRanges.add(rangeKey);
    verified.push({
      id: ob.id,
      statement: ob.statement,
      quote: ob.quote,
      offsets: [start, end],
    });
  }
  return { verified, dropped };
}

/**
 * Pass A: extraction. Repair loop of at most llmConfig.maxRetriesPerPass
 * retries; a retry happens when the output fails schema validation or yields
 * zero verified obligations.
 */
export async function runPassA(
  provider: LlmProvider,
  policyText: string,
): Promise<PassAResult> {
  const runs: PassARun[] = [];
  let lastError = "";

  for (let attempt = 0; attempt <= llmConfig.maxRetriesPerPass; attempt++) {
    const { fenced } = fenceDocument(policyText);
    const user =
      attempt === 0
        ? `Extract the obligations from this policy document:\n\n${fenced}`
        : `Extract the obligations from this policy document:\n\n${fenced}\n\nYour previous attempt failed verification: ${lastError}\nReturn corrected obligations. Every quote must be copied verbatim from the document with exact offsets.`;

    let result: CompletionResult;
    try {
      result = await provider.complete({
        kind: "passA",
        model: llmConfig.extractionModel,
        system: SYSTEM_PROMPT,
        user,
        maxTokens: llmConfig.maxOutputTokens,
        schema: PASS_A_JSON_SCHEMA as unknown as Record<string, unknown>,
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      runs.push({
        input: { attempt, system: SYSTEM_PROMPT, user },
        output: { error: lastError },
        modelVersion: "error",
        latencyMs: 0,
      });
      continue;
    }

    runs.push({
      input: { attempt, system: SYSTEM_PROMPT, user },
      output: safeParseJson(result.text),
      modelVersion: result.modelVersion,
      latencyMs: result.latencyMs,
    });

    const parsed = passAOutputSchema.safeParse(safeParseJson(result.text));
    if (!parsed.success) {
      lastError = `output did not match the schema: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => i.message)
        .join("; ")}`;
      continue;
    }

    const { verified, dropped } = verifyObligations(policyText, parsed.data);
    if (verified.length === 0) {
      lastError =
        parsed.data.obligations.length === 0
          ? "no obligations were extracted"
          : "every quote failed offset verification (quote must be a verbatim substring)";
      continue;
    }
    return { obligations: verified, runs, droppedCount: dropped };
  }

  throw new PassFailedError("passA", lastError, runs);
}

export class PassFailedError extends Error {
  constructor(
    public readonly pass: string,
    public readonly reason: string,
    public readonly runs: PassARun[],
  ) {
    super(`${pass} failed after retries: ${reason}`);
  }
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { unparseable: text.slice(0, 2000) };
  }
}
