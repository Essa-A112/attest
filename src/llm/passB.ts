import { z } from "zod";
import { llmConfig } from "./config";
import { UNTRUSTED_DATA_RULES } from "./fence";
import type { LlmProvider } from "./provider";
import type { VerifiedObligation } from "./passA";
import {
  checkQuestion,
  isDistributionSkewed,
  type CandidateQuestion,
  type FlaggedQuestion,
} from "./validate";
import { PassFailedError, type PassARun } from "./passA";

const questionSchema = z.object({
  obligation_id: z.string().min(1),
  scenario: z.string().min(1),
  options: z.array(z.string()).length(4),
  correct: z.int().min(0).max(3),
  rationale: z.string().min(1),
});

const passBOutputSchema = z.object({
  questions: z.array(questionSchema),
});

const PASS_B_JSON_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          obligation_id: { type: "string" },
          scenario: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          correct: { type: "integer" },
          rationale: { type: "string" },
        },
        required: ["obligation_id", "scenario", "options", "correct", "rationale"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You write scenario-based training questions from policy obligations.

${UNTRUSTED_DATA_RULES}
(The obligation statements and quotes below were extracted from a customer document; the same rule applies to them.)

For EACH obligation in the input, write exactly one multiple-choice question:
- obligation_id: the id of the obligation the question tests
- scenario: a concrete workplace situation in the second person ("you"), UNDER 40 words, that puts the obligation to the test. No generic ethics questions — the scenario must hinge on this specific rule.
- options: exactly 4 distinct courses of action. One is what the policy requires. The other three are plausible violations — things a reasonable but mistaken employee might actually do, not absurd choices.
- correct: the 0-based index of the compliant option. Vary this index so correct answers are spread roughly evenly across positions 0-3 over the whole set.
- rationale: one or two sentences explaining the correct answer, quoting or citing the exact clause.`;

export interface PassBResult {
  questions: FlaggedQuestion[];
  runs: PassARun[];
}

function buildUserContent(obligations: VerifiedObligation[], errorFeedback?: string): string {
  const payload = obligations.map((ob) => ({
    id: ob.id,
    statement: ob.statement,
    quote: ob.quote,
  }));
  const base = `Write one question per obligation:\n\n<obligations-json>${JSON.stringify(payload)}</obligations-json>`;
  return errorFeedback
    ? `${base}\n\nYour previous attempt was rejected: ${errorFeedback}\nReturn a corrected full set.`
    : base;
}

/**
 * Pass B: generation, per batch of obligations. Repair loop of at most two
 * retries per batch; a retry fires on schema failure, zero usable questions,
 * or a heavily skewed correct-index distribution. Per-question programmatic
 * flags do NOT trigger retries — flagged questions go to the review queue.
 */
export async function runPassB(
  provider: LlmProvider,
  obligations: VerifiedObligation[],
  batchSize = 8,
): Promise<PassBResult> {
  const allQuestions: FlaggedQuestion[] = [];
  const runs: PassARun[] = [];

  for (let i = 0; i < obligations.length; i += batchSize) {
    const batch = obligations.slice(i, i + batchSize);
    const result = await runBatch(provider, batch, runs);
    allQuestions.push(...result);
  }
  return { questions: allQuestions, runs };
}

async function runBatch(
  provider: LlmProvider,
  batch: VerifiedObligation[],
  runs: PassARun[],
): Promise<FlaggedQuestion[]> {
  const known = new Set(batch.map((ob) => ob.id));
  let lastError = "";

  for (let attempt = 0; attempt <= llmConfig.maxRetriesPerPass; attempt++) {
    const user = buildUserContent(batch, attempt > 0 ? lastError : undefined);
    let text: string;
    try {
      const result = await provider.complete({
        kind: "passB",
        model: llmConfig.generationModel,
        system: SYSTEM_PROMPT,
        user,
        maxTokens: llmConfig.maxOutputTokens,
        schema: PASS_B_JSON_SCHEMA as unknown as Record<string, unknown>,
      });
      text = result.text;
      runs.push({
        input: { attempt, system: SYSTEM_PROMPT, user },
        output: safeParseJson(text),
        modelVersion: result.modelVersion,
        latencyMs: result.latencyMs,
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

    const parsed = passBOutputSchema.safeParse(safeParseJson(text));
    if (!parsed.success) {
      lastError = `output did not match the schema: ${parsed.error.issues
        .slice(0, 3)
        .map((iss) => iss.message)
        .join("; ")}`;
      continue;
    }

    const candidates: CandidateQuestion[] = parsed.data.questions;
    if (candidates.length === 0) {
      lastError = "no questions were generated";
      continue;
    }
    if (isDistributionSkewed(candidates) && attempt < llmConfig.maxRetriesPerPass) {
      lastError =
        "correct answers are clustered on one index; spread them roughly evenly across positions 0-3";
      continue;
    }

    return candidates.map((q) => ({ ...q, flags: checkQuestion(q, known) }));
  }

  throw new PassFailedError("passB", lastError, runs);
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { unparseable: text.slice(0, 2000) };
  }
}
