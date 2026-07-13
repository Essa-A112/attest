import { eq } from "drizzle-orm";
import { db } from "@/db";
import { courses, generationRuns, obligations, policies, questions } from "@/db/schema";
import { runPassA, PassFailedError, type PassARun, type VerifiedObligation } from "@/llm/passA";
import { runPassB } from "@/llm/passB";
import { runPassC } from "@/llm/passC";
import { getProvider, type LlmProvider } from "@/llm/provider";

async function logRuns(courseId: string, pass: "A" | "B" | "C", runs: PassARun[]) {
  for (const run of runs) {
    await db.insert(generationRuns).values({
      courseId,
      pass,
      input: run.input,
      output: run.output,
      modelVersion: run.modelVersion,
      latencyMs: run.latencyMs,
    });
  }
}

async function setStatus(
  courseId: string,
  status: "extracting" | "generating" | "checking" | "ready" | "failed",
  error?: string,
) {
  await db
    .update(courses)
    .set({ generationStatus: status, generationError: error ?? null })
    .where(eq(courses.id, courseId));
}

/**
 * The generation pipeline for one course. Issue 4 implements pass A; passes B
 * and C extend this function. Every model call (including retries) is logged to
 * generation_runs before status changes, so failures stay auditable.
 */
export async function runCourseGeneration(
  courseId: string,
  providerOverride?: LlmProvider,
): Promise<void> {
  const course = await db.query.courses.findFirst({ where: eq(courses.id, courseId) });
  if (!course) throw new Error(`course ${courseId} not found`);
  const policy = await db.query.policies.findFirst({
    where: eq(policies.id, course.policyId),
  });
  if (!policy) throw new Error(`policy for course ${courseId} not found`);

  const provider = providerOverride ?? (await getProvider());

  try {
    // Pass A: extraction with offset verification.
    await setStatus(courseId, "extracting");
    const passA = await runPassA(provider, policy.text);
    await logRuns(courseId, "A", passA.runs);

    const obligationIdByLabel = new Map<string, string>();
    const obligationByLabel = new Map<string, VerifiedObligation>();
    for (const ob of passA.obligations) {
      const [row] = await db
        .insert(obligations)
        .values({
          courseId,
          label: ob.id,
          statement: ob.statement,
          quote: ob.quote,
          offsets: ob.offsets,
        })
        .returning();
      if (!row) throw new Error("obligation insert failed");
      obligationIdByLabel.set(ob.id, row.id);
      obligationByLabel.set(ob.id, ob);
    }

    // Pass B: question generation per batch of obligations.
    await setStatus(courseId, "generating");
    const passB = await runPassB(provider, passA.obligations);
    await logRuns(courseId, "B", passB.runs);

    // Pass C: programmatic flags already attached in B; add checker verdicts.
    await setStatus(courseId, "checking");
    const passC = await runPassC(provider, passB.questions, obligationByLabel);
    await logRuns(courseId, "C", passC.runs);

    for (const q of passC.questions) {
      const obligationId = obligationIdByLabel.get(q.obligation_id);
      const source = obligationByLabel.get(q.obligation_id);
      if (!obligationId || !source) {
        // unknown obligation_id was already flagged; without a referent we
        // cannot store the row, so it is dropped and the flag recorded in runs
        continue;
      }
      await db.insert(questions).values({
        courseId,
        obligationId,
        scenario: q.scenario,
        options: q.options,
        correct: q.correct,
        rationale: q.rationale,
        sourceQuote: source.quote,
        sourceOffsets: source.offsets,
        reviewStatus: "pending",
        checkFlags: q.flags,
        checkerNotes: q.checkerNotes,
      });
    }

    await setStatus(courseId, "ready");
  } catch (err) {
    if (err instanceof PassFailedError) {
      const passLetter = err.pass === "passA" ? "A" : err.pass === "passB" ? "B" : "C";
      await logRuns(courseId, passLetter, err.runs);
      await setStatus(courseId, "failed", err.reason);
      return;
    }
    await setStatus(courseId, "failed", err instanceof Error ? err.message : "unknown error");
    throw err;
  }
}
