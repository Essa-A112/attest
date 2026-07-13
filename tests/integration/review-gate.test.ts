import "../setup-env";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { courses, obligations, questions } from "@/db/schema";
import {
  approveQuestion,
  canPublish,
  editQuestion,
  rejectQuestion,
  reviewSummary,
  ReviewError,
  validateEdit,
} from "@/courses/review";
import { createPolicyVersion } from "@/ingest/policies";
import { createOrg, createUser, resetDb } from "../helpers/db";

async function setupCourseWithQuestions(orgName = "Org A", questionCount = 2) {
  const org = await createOrg(orgName);
  const admin = await createUser(org.id, `admin@${orgName.toLowerCase().replace(" ", "-")}.test`);
  const policy = await createPolicyVersion({
    orgId: org.id,
    title: "Expenses",
    text: "Claims must be submitted within 30 days. Receipts are required above 25 pounds.",
    sourceKind: "text",
  });
  const [course] = await db
    .insert(courses)
    .values({ policyId: policy.id, version: policy.version, createdBy: admin.id })
    .returning();
  if (!course) throw new Error("course insert failed");

  const [ob] = await db
    .insert(obligations)
    .values({
      courseId: course.id,
      label: "OB-1",
      statement: "Submit claims within 30 days.",
      quote: "Claims must be submitted within 30 days.",
      offsets: [0, 41],
    })
    .returning();
  if (!ob) throw new Error("obligation insert failed");

  const qs = [];
  for (let i = 0; i < questionCount; i++) {
    const [q] = await db
      .insert(questions)
      .values({
        courseId: course.id,
        obligationId: ob.id,
        scenario: `Scenario ${i}: a claim is late. What do you do?`,
        options: ["Follow the policy", "Ignore it", "Ask later", "Backdate it"],
        correct: 0,
        rationale: "The policy requires claims within 30 days.",
        sourceQuote: ob.quote,
        sourceOffsets: ob.offsets,
      })
      .returning();
    if (!q) throw new Error("question insert failed");
    qs.push(q);
  }
  return { org, admin, course, questions: qs };
}

describe("review gate", () => {
  beforeEach(resetDb);

  it("approve/reject/edit set review_status", async () => {
    const { org, admin, course, questions: qs } = await setupCourseWithQuestions("Org A", 3);
    const [q1, q2, q3] = qs;
    if (!q1 || !q2 || !q3) throw new Error("fixture");

    await approveQuestion(org.id, admin.id, q1.id);
    await rejectQuestion(org.id, admin.id, q2.id);
    await editQuestion(org.id, admin.id, q3.id, {
      scenario: "Edited scenario: the deadline passed. What now?",
      options: ["Tell finance now", "Hide it", "Claim next month", "Round it down"],
      correct: 0,
      rationale: "Claims must go in within 30 days.",
    });

    const summary = await reviewSummary(course.id);
    expect(summary).toEqual({ total: 3, pending: 0, approved: 1, edited: 1, rejected: 1 });

    const edited = await db.query.questions.findFirst({ where: eq(questions.id, q3.id) });
    expect(edited?.scenario).toContain("Edited scenario");
    expect(edited?.reviewStatus).toBe("edited");
  });

  it("cannot publish while any question is pending", async () => {
    const { org, admin, course, questions: qs } = await setupCourseWithQuestions("Org A", 2);
    const [q1] = qs;
    if (!q1) throw new Error("fixture");

    await approveQuestion(org.id, admin.id, q1.id);
    const summary = await reviewSummary(course.id);
    expect(summary.pending).toBe(1);
    expect(canPublish(summary)).toBe(false);
  });

  it("can publish once every question is resolved with at least one approval", async () => {
    const { org, admin, course, questions: qs } = await setupCourseWithQuestions("Org A", 2);
    const [q1, q2] = qs;
    if (!q1 || !q2) throw new Error("fixture");

    await approveQuestion(org.id, admin.id, q1.id);
    await rejectQuestion(org.id, admin.id, q2.id);
    expect(canPublish(await reviewSummary(course.id))).toBe(true);
  });

  it("cannot publish when everything is rejected or there are no questions", async () => {
    const { org, admin, course, questions: qs } = await setupCourseWithQuestions("Org A", 1);
    const [q1] = qs;
    if (!q1) throw new Error("fixture");
    await rejectQuestion(org.id, admin.id, q1.id);
    expect(canPublish(await reviewSummary(course.id))).toBe(false);
    expect(canPublish({ total: 0, pending: 0, approved: 0, edited: 0, rejected: 0 })).toBe(false);
  });

  it("rejects invalid edits", () => {
    expect(
      validateEdit({
        scenario: "s",
        options: ["a", "a", "b", "c"],
        correct: 0,
        rationale: "r",
      }),
    ).toMatch(/distinct/);
    expect(
      validateEdit({ scenario: "s", options: ["a", "b", "c", "d"], correct: 5, rationale: "r" }),
    ).toMatch(/correct/);
  });

  it("locks reviews once the course is published", async () => {
    const { org, admin, course, questions: qs } = await setupCourseWithQuestions("Org A", 1);
    const [q1] = qs;
    if (!q1) throw new Error("fixture");
    await approveQuestion(org.id, admin.id, q1.id);
    await db.update(courses).set({ status: "published" }).where(eq(courses.id, course.id));

    await expect(rejectQuestion(org.id, admin.id, q1.id)).rejects.toThrow(ReviewError);
  });

  it("cross-tenant: org B cannot review org A's questions", async () => {
    const { questions: qs } = await setupCourseWithQuestions("Org A", 1);
    const orgB = await createOrg("Org B");
    const adminB = await createUser(orgB.id, "admin@org-b.test");
    const [q1] = qs;
    if (!q1) throw new Error("fixture");

    await expect(approveQuestion(orgB.id, adminB.id, q1.id)).rejects.toThrow(/not found/);
    const untouched = await db.query.questions.findFirst({ where: eq(questions.id, q1.id) });
    expect(untouched?.reviewStatus).toBe("pending");
  });
});
