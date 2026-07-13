import "../setup-env";
import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assignments, courses, obligations, questions } from "@/db/schema";
import { publishCourse } from "@/courses/publish";
import { approveQuestion, rejectQuestion } from "@/courses/review";
import { collectEvidence } from "@/evidence/collect";
import { buildEvidenceCsv, buildEvidencePdf } from "@/evidence/render";
import { extractFromPdf } from "@/ingest/extract";
import { createPolicyVersion } from "@/ingest/policies";
import { recordAttempt } from "@/training";
import { createOrg, createUser, resetDb } from "../helpers/db";

const EMAIL = "jane@corp.test";

async function setupCompletedCourse() {
  const org = await createOrg("Evidence Org");
  const admin = await createUser(org.id, "admin@evidence.test");
  const policy = await createPolicyVersion({
    orgId: org.id,
    title: "Data Handling",
    text: "Staff must lock screens when away. Breaches must be reported within 24 hours.",
    sourceKind: "text",
  });
  const [course] = await db
    .insert(courses)
    .values({ policyId: policy.id, version: policy.version, createdBy: admin.id })
    .returning();
  if (!course) throw new Error("course insert failed");

  const quotes = [
    "Staff must lock screens when away.",
    "Breaches must be reported within 24 hours.",
  ];
  const qids: string[] = [];
  for (const [i, quote] of quotes.entries()) {
    const start = policy.text.indexOf(quote);
    const [ob] = await db
      .insert(obligations)
      .values({
        courseId: course.id,
        label: `OB-${i + 1}`,
        statement: quote,
        quote,
        offsets: [start, start + quote.length],
      })
      .returning();
    if (!ob) throw new Error("ob insert failed");
    const [q] = await db
      .insert(questions)
      .values({
        courseId: course.id,
        obligationId: ob.id,
        scenario: `Scenario ${i + 1}: what do you do?`,
        options: ["Follow the policy", "Ignore it", "Improvise", "Ask nobody"],
        correct: 0,
        rationale: `The policy says: "${quote}"`,
        sourceQuote: quote,
        sourceOffsets: [start, start + quote.length],
      })
      .returning();
    if (!q) throw new Error("q insert failed");
    qids.push(q.id);
  }
  // one approved, one rejected: the pack must contain only the approved one
  const [qa, qb] = qids;
  if (!qa || !qb) throw new Error("fixture");
  await approveQuestion(org.id, admin.id, qa);
  await rejectQuestion(org.id, admin.id, qb);
  // re-approve second? No: keep 1 approved. Publish needs >=1 approved.
  await publishCourse(org.id, admin.id, course.id, {
    passMark: 80,
    dueAt: null,
    emails: [EMAIL],
  });
  const [assignment] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.courseId, course.id));
  if (!assignment) throw new Error("no assignment");
  await recordAttempt(assignment.token, "0");
  return { org, course, policy, assignment };
}

describe("evidence pack", () => {
  beforeEach(async () => {
    await resetDb();
    rmSync(".dev-mail", { recursive: true, force: true });
  });

  it("collects policy hash, approved-only questions, pseudonymous outcomes, chain result", async () => {
    const { org, course, policy } = await setupCompletedCourse();
    const pack = await collectEvidence(org.id, course.id);
    if (!pack) throw new Error("no pack");

    expect(pack.policy.sha256).toBe(policy.sha256);
    expect(pack.questions).toHaveLength(1); // rejected question excluded
    expect(pack.chain.status).toBe("intact");
    expect(pack.outcomes).toHaveLength(1);
    expect(pack.outcomes[0]?.passed).toBe(true);
    expect(pack.outcomes[0]?.pseudonym).toMatch(/^TR-/);
    // no PII anywhere in the pack
    expect(JSON.stringify(pack)).not.toContain(EMAIL);
  });

  it("CSV lists outcomes by pseudonym and never contains PII", async () => {
    const { org, course } = await setupCompletedCourse();
    const pack = await collectEvidence(org.id, course.id);
    if (!pack) throw new Error("no pack");
    const csv = buildEvidenceCsv(pack);

    expect(csv).toContain("trainee_pseudonym");
    expect(csv).toContain("TR-");
    expect(csv).toContain("true");
    expect(csv).not.toContain(EMAIL);
  });

  it("PDF contains the policy hash, chain result, questions, and outcomes", async () => {
    const { org, course, policy } = await setupCompletedCourse();
    const pack = await collectEvidence(org.id, course.id);
    if (!pack) throw new Error("no pack");
    const pdf = await buildEvidencePdf(pack);

    const text = await extractFromPdf(pdf);
    expect(text).toContain("Attest Evidence Pack");
    expect(text).toContain(policy.sha256);
    expect(text).toContain("INTACT");
    expect(text).toContain("Scenario 1");
    expect(text).toContain(pack.outcomes[0]?.pseudonym ?? "@@missing@@");
    expect(text).not.toContain(EMAIL);
  });

  it("cross-tenant: another org cannot collect this course's evidence", async () => {
    const { course } = await setupCompletedCourse();
    const other = await createOrg("Other Org");
    expect(await collectEvidence(other.id, course.id)).toBeUndefined();
  });
});
