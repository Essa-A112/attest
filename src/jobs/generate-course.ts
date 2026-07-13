import { eq } from "drizzle-orm";
import { db } from "@/db";
import { courses, generationRuns, obligations, policies } from "@/db/schema";
import { runPassA, PassFailedError, type PassARun } from "@/llm/passA";
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

  await setStatus(courseId, "extracting");
  try {
    const passA = await runPassA(provider, policy.text);
    await logRuns(courseId, "A", passA.runs);

    for (const ob of passA.obligations) {
      await db.insert(obligations).values({
        courseId,
        label: ob.id,
        statement: ob.statement,
        quote: ob.quote,
        offsets: ob.offsets,
      });
    }
    await setStatus(courseId, "ready");
  } catch (err) {
    if (err instanceof PassFailedError) {
      await logRuns(courseId, "A", err.runs);
      await setStatus(courseId, "failed", err.reason);
      return;
    }
    await setStatus(courseId, "failed", err instanceof Error ? err.message : "unknown error");
    throw err;
  }
}
