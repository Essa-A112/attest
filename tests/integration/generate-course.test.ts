import "../setup-env";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { courses, generationRuns, obligations } from "@/db/schema";
import { createPolicyVersion } from "@/ingest/policies";
import { runCourseGeneration } from "@/jobs/generate-course";
import { ScriptedProvider } from "@/llm/provider";
import { createOrg, createUser, resetDb } from "../helpers/db";

const POLICY_TEXT = [
  "Expenses Policy.",
  "Claims must be submitted within 30 days of the expense.",
  "Receipts are required for any claim above 25 pounds.",
].join("\n");

async function setupCourse() {
  const org = await createOrg("Org A");
  const admin = await createUser(org.id, "admin@org-a.test");
  const policy = await createPolicyVersion({
    orgId: org.id,
    title: "Expenses",
    text: POLICY_TEXT,
    sourceKind: "text",
  });
  const [course] = await db
    .insert(courses)
    .values({ policyId: policy.id, version: policy.version, createdBy: admin.id })
    .returning();
  if (!course) throw new Error("course insert failed");
  return { org, policy, course };
}

function quoteAt(text: string, quote: string) {
  const start = text.indexOf(quote);
  return { quote, start, end: start + quote.length };
}

describe("course generation: pass A", () => {
  beforeEach(resetDb);

  it("stores verified obligations and logs the run", async () => {
    const { course, policy } = await setupCourse();
    const q1 = quoteAt(policy.text, "Claims must be submitted within 30 days of the expense.");
    const q2 = quoteAt(policy.text, "Receipts are required for any claim above 25 pounds.");
    const provider = new ScriptedProvider([
      JSON.stringify({
        obligations: [
          { id: "OB-1", statement: "Submit claims within 30 days.", ...q1 },
          { id: "OB-2", statement: "Provide receipts above £25.", ...q2 },
          // fabricated quote: must be dropped by offset verification
          { id: "OB-3", statement: "Made up.", quote: "Nonexistent sentence.", start: 0, end: 21 },
        ],
      }),
    ]);

    await runCourseGeneration(course.id, provider);

    const storedObs = await db
      .select()
      .from(obligations)
      .where(eq(obligations.courseId, course.id));
    expect(storedObs).toHaveLength(2);
    for (const ob of storedObs) {
      expect(policy.text.slice(ob.offsets[0], ob.offsets[1])).toBe(ob.quote);
    }

    const runs = await db
      .select()
      .from(generationRuns)
      .where(eq(generationRuns.courseId, course.id));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.pass).toBe("A");
    expect(runs[0]?.modelVersion).toContain("scripted");

    const updated = await db.query.courses.findFirst({ where: eq(courses.id, course.id) });
    expect(updated?.generationStatus).toBe("ready");
  });

  it("marks the course failed after exhausting retries, logging every attempt", async () => {
    const { course } = await setupCourse();
    const empty = JSON.stringify({ obligations: [] });
    const provider = new ScriptedProvider([empty, empty, empty]);

    await runCourseGeneration(course.id, provider);

    const updated = await db.query.courses.findFirst({ where: eq(courses.id, course.id) });
    expect(updated?.generationStatus).toBe("failed");
    expect(updated?.generationError).toBeTruthy();

    const runs = await db
      .select()
      .from(generationRuns)
      .where(eq(generationRuns.courseId, course.id));
    expect(runs).toHaveLength(3);
  });
});
