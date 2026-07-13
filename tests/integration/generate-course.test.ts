import "../setup-env";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { courses, generationRuns, obligations, questions } from "@/db/schema";
import { createPolicyVersion } from "@/ingest/policies";
import { runCourseGeneration } from "@/jobs/generate-course";
import { DevStubProvider } from "@/llm/dev-stub";
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

describe("course generation pipeline (passes A, B, C)", () => {
  beforeEach(resetDb);

  it("runs all three passes, stores flagged questions pending review, logs every run", async () => {
    const { course, policy } = await setupCourse();
    const q1 = quoteAt(policy.text, "Claims must be submitted within 30 days of the expense.");
    const q2 = quoteAt(policy.text, "Receipts are required for any claim above 25 pounds.");
    const provider = new ScriptedProvider([
      // pass A
      JSON.stringify({
        obligations: [
          { id: "OB-1", statement: "Submit claims within 30 days.", ...q1 },
          { id: "OB-2", statement: "Provide receipts above £25.", ...q2 },
          // fabricated quote: must be dropped by offset verification
          { id: "OB-3", statement: "Made up.", quote: "Nonexistent sentence.", start: 0, end: 21 },
        ],
      }),
      // pass B
      JSON.stringify({
        questions: [
          {
            obligation_id: "OB-1",
            scenario: "You paid for a client lunch six weeks ago and just found the receipt. What do you do?",
            options: [
              "Submit it anyway and hope",
              "Ask your manager to backdate it",
              "Check with finance: the 30-day window has passed",
              "Add it to next month's claim quietly",
            ],
            correct: 2,
            rationale: 'The policy says: "Claims must be submitted within 30 days of the expense."',
          },
          {
            obligation_id: "OB-2",
            scenario: "You lost the receipt for a 40 pound taxi. What do you do?",
            options: [
              "Claim it without a receipt",
              "Split it into two smaller claims",
              "Ask the driver for a duplicate receipt before claiming",
              "Round it down to 24 pounds",
            ],
            correct: 2,
            rationale: 'The policy says: "Receipts are required for any claim above 25 pounds."',
          },
        ],
      }),
      // pass C
      JSON.stringify({
        results: [
          { index: 0, keyed_answer_follows: true, distractors_defensible: true, notes: "" },
          { index: 1, keyed_answer_follows: false, distractors_defensible: true, notes: "clause does not say how to replace receipts" },
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

    const storedQs = await db
      .select()
      .from(questions)
      .where(eq(questions.courseId, course.id));
    expect(storedQs).toHaveLength(2);
    // every question is pending: nothing reaches a trainee before review
    expect(storedQs.every((q) => q.reviewStatus === "pending")).toBe(true);
    // checker failure flagged, not discarded
    const flagged = storedQs.find((q) => q.checkFlags.length > 0);
    expect(flagged?.checkFlags.some((f) => f.includes("keyed answer"))).toBe(true);
    expect(flagged?.checkerNotes).toContain("receipts");
    // source quote + offsets copied from the obligation
    for (const q of storedQs) {
      expect(policy.text.slice(q.sourceOffsets[0], q.sourceOffsets[1])).toBe(q.sourceQuote);
    }

    const runs = await db
      .select()
      .from(generationRuns)
      .where(eq(generationRuns.courseId, course.id));
    expect(runs.map((r) => r.pass).sort()).toEqual(["A", "B", "C"]);

    const updated = await db.query.courses.findFirst({ where: eq(courses.id, course.id) });
    expect(updated?.generationStatus).toBe("ready");
  });

  it("dev stub provider drives the whole pipeline (dev/demo path)", async () => {
    const { course } = await setupCourse();
    await runCourseGeneration(course.id, new DevStubProvider());

    const storedQs = await db
      .select()
      .from(questions)
      .where(eq(questions.courseId, course.id));
    expect(storedQs.length).toBeGreaterThan(0);
    expect(storedQs.every((q) => q.reviewStatus === "pending")).toBe(true);
    expect(storedQs.every((q) => q.options.length === 4)).toBe(true);

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
