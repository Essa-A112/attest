import "../setup-env";
import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assignments, attempts, courses, obligations, questions, trainees } from "@/db/schema";
import { publishCourse, PublishError } from "@/courses/publish";
import { approveQuestion } from "@/courses/review";
import { createPolicyVersion } from "@/ingest/policies";
import { GENESIS_PREV_HASH, computeRowHash } from "@/ledger";
import {
  getAssignmentByToken,
  getTraineeQuestions,
  markAnswers,
  parseAnswers,
  recordAttempt,
} from "@/training";
import { eraseTrainee, upsertTrainees } from "@/trainees";
import { createOrg, createUser, resetDb } from "../helpers/db";

async function setupPublishableCourse(orgName = "Org A") {
  const org = await createOrg(orgName);
  const slug = orgName.toLowerCase().replace(/\s+/g, "-");
  const admin = await createUser(org.id, `admin@${slug}.test`);
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
    await approveQuestion(org.id, admin.id, q.id);
    qids.push(q.id);
  }
  return { org, admin, course, policy, questionIds: qids };
}

describe("publish and trainee flow", () => {
  beforeEach(async () => {
    await resetDb();
    rmSync(".dev-mail", { recursive: true, force: true });
  });

  it("publishing creates trainees, assignments with tokens, and sends links", async () => {
    const { org, admin, course } = await setupPublishableCourse();
    const { assignmentCount } = await publishCourse(org.id, admin.id, course.id, {
      passMark: 80,
      dueAt: new Date("2026-08-01T23:59:59Z"),
      emails: ["jane@corp.test", "Sam@Corp.test", "jane@corp.test"],
    });

    expect(assignmentCount).toBe(2); // deduped, case-insensitive

    const traineeRows = await db.select().from(trainees).where(eq(trainees.orgId, org.id));
    expect(traineeRows).toHaveLength(2);
    expect(traineeRows.every((t) => t.pseudonym.startsWith("TR-"))).toBe(true);

    const assignmentRows = await db
      .select()
      .from(assignments)
      .where(eq(assignments.courseId, course.id));
    expect(assignmentRows).toHaveLength(2);
    // assignments carry pseudonyms, never emails
    for (const a of assignmentRows) {
      expect(a.traineePseudonym).toMatch(/^TR-/);
      expect(a.token).toMatch(/^[0-9a-f]{48}$/);
    }

    const updated = await db.query.courses.findFirst({ where: eq(courses.id, course.id) });
    expect(updated?.status).toBe("published");
    expect(updated?.passMark).toBe(80);
  });

  it("publish is refused while the gate is not satisfied", async () => {
    const { org, admin, course, questionIds } = await setupPublishableCourse();
    const [q1] = questionIds;
    if (!q1) throw new Error("fixture");
    await db.update(questions).set({ reviewStatus: "pending" }).where(eq(questions.id, q1));

    await expect(
      publishCourse(org.id, admin.id, course.id, {
        passMark: 80,
        dueAt: null,
        emails: ["jane@corp.test"],
      }),
    ).rejects.toThrow(PublishError);
  });

  it("re-publishing to the same email reuses the pseudonym", async () => {
    const { org } = await setupPublishableCourse();
    const first = await upsertTrainees(org.id, ["jane@corp.test"]);
    const second = await upsertTrainees(org.id, ["JANE@corp.test"]);
    expect(first[0]?.pseudonym).toBe(second[0]?.pseudonym);
  });

  it("trainee completes the course end to end; attempt lands on the hash chain", async () => {
    const { org, admin, course } = await setupPublishableCourse();
    await publishCourse(org.id, admin.id, course.id, {
      passMark: 80,
      dueAt: null,
      emails: ["jane@corp.test"],
    });
    const [assignment] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.courseId, course.id));
    if (!assignment) throw new Error("no assignment");

    // token resolves to the published course
    const ctx = await getAssignmentByToken(assignment.token);
    expect(ctx?.policy.title).toBe("Data Handling");

    // trainee sees only approved questions
    const qs = await getTraineeQuestions(course.id);
    expect(qs).toHaveLength(2);

    // all correct -> pass, ledger row chained from genesis
    const result = await recordAttempt(assignment.token, "00");
    expect(result.passed).toBe(true);
    expect(result.score).toBe(2);

    const [attempt] = await db
      .select()
      .from(attempts)
      .where(eq(attempts.assignmentId, assignment.id));
    if (!attempt) throw new Error("no attempt row");
    expect(attempt.prevHash).toBe(GENESIS_PREV_HASH);
    expect(attempt.rowHash).toBe(
      computeRowHash(GENESIS_PREV_HASH, {
        orgId: attempt.orgId,
        assignmentId: attempt.assignmentId,
        courseId: attempt.courseId,
        traineePseudonym: attempt.traineePseudonym,
        answers: attempt.answers,
        score: attempt.score,
        total: attempt.total,
        passed: attempt.passed,
        createdAt: attempt.createdAt.toISOString(),
      }),
    );
    // PII never in the ledger row
    expect(JSON.stringify(attempt)).not.toContain("jane@corp.test");

    const updatedAssignment = await db.query.assignments.findFirst({
      where: eq(assignments.id, assignment.id),
    });
    expect(updatedAssignment?.completedAt).not.toBeNull();
  });

  it("failed attempts chain too and allow retakes; second attempt links to first", async () => {
    const { org, admin, course } = await setupPublishableCourse();
    await publishCourse(org.id, admin.id, course.id, {
      passMark: 80,
      dueAt: null,
      emails: ["jane@corp.test"],
    });
    const [assignment] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.courseId, course.id));
    if (!assignment) throw new Error("no assignment");

    const fail = await recordAttempt(assignment.token, "11");
    expect(fail.passed).toBe(false);

    const pass = await recordAttempt(assignment.token, "00");
    expect(pass.passed).toBe(true);

    const rows = await db
      .select()
      .from(attempts)
      .where(eq(attempts.orgId, org.id))
      .orderBy(attempts.seq);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.prevHash).toBe(GENESIS_PREV_HASH);
    expect(rows[1]?.prevHash).toBe(rows[0]?.rowHash);
  });

  it("unpublished/unknown tokens resolve to nothing", async () => {
    await setupPublishableCourse();
    expect(await getAssignmentByToken("no-such-token")).toBeUndefined();
  });

  it("erasure deletes PII but assignments and attempts survive", async () => {
    const { org, admin, course } = await setupPublishableCourse();
    await publishCourse(org.id, admin.id, course.id, {
      passMark: 80,
      dueAt: null,
      emails: ["jane@corp.test"],
    });
    const [assignment] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.courseId, course.id));
    if (!assignment) throw new Error("no assignment");
    await recordAttempt(assignment.token, "00");

    const [trainee] = await db.select().from(trainees).where(eq(trainees.orgId, org.id));
    if (!trainee) throw new Error("no trainee");
    expect(await eraseTrainee(org.id, trainee.id)).toBe(true);

    expect(await db.select().from(trainees).where(eq(trainees.orgId, org.id))).toHaveLength(0);
    expect(
      await db.select().from(assignments).where(eq(assignments.courseId, course.id)),
    ).toHaveLength(1);
    expect(await db.select().from(attempts).where(eq(attempts.orgId, org.id))).toHaveLength(1);
  });

  it("cross-tenant: erasure is org-scoped", async () => {
    const { org } = await setupPublishableCourse("Org A");
    await upsertTrainees(org.id, ["jane@corp.test"]);
    const orgB = await createOrg("Org B");
    const [trainee] = await db.select().from(trainees).where(eq(trainees.orgId, org.id));
    if (!trainee) throw new Error("no trainee");
    expect(await eraseTrainee(orgB.id, trainee.id)).toBe(false);
  });
});

describe("marking", () => {
  it("marks answers and applies the pass mark", () => {
    const qs = [{ correct: 0 }, { correct: 2 }, { correct: 1 }, { correct: 3 }];
    expect(markAnswers(qs, [0, 2, 1, 3], 80)).toEqual({
      score: 4,
      total: 4,
      percent: 100,
      passed: true,
    });
    expect(markAnswers(qs, [0, 2, 0, 0], 80).passed).toBe(false);
    expect(markAnswers(qs, [0, 2, 1, 0], 75).passed).toBe(true);
  });

  it("parses answer strings defensively", () => {
    expect(parseAnswers("0312", 4)).toEqual([0, 3, 1, 2]);
    expect(parseAnswers("9x", 4)).toEqual([]);
    expect(parseAnswers(undefined, 4)).toEqual([]);
    expect(parseAnswers("00000", 3)).toEqual([0, 0, 0]);
  });
});
