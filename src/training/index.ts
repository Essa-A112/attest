import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { assignments, courses, obligations, policies, questions } from "@/db/schema";
import { appendAttempt } from "@/ledger";

/**
 * The trainee-facing flow. Authentication is the assignment token (a
 * capability); there are no trainee accounts. Trainees only ever see
 * approved or edited questions — the review gate is upstream of this module.
 */

export async function getAssignmentByToken(token: string) {
  const [row] = await db
    .select({ assignment: assignments, course: courses, policy: policies })
    .from(assignments)
    .innerJoin(courses, eq(assignments.courseId, courses.id))
    .innerJoin(policies, eq(courses.policyId, policies.id))
    .where(eq(assignments.token, token));
  if (!row) return undefined;
  if (row.course.status !== "published") return undefined;
  return row;
}

/** Questions a trainee may see: approved or edited only, stable order. */
export async function getTraineeQuestions(courseId: string) {
  return db
    .select()
    .from(questions)
    .where(
      and(
        eq(questions.courseId, courseId),
        inArray(questions.reviewStatus, ["approved", "edited"]),
      ),
    )
    .orderBy(asc(questions.createdAt), asc(questions.id));
}

export async function getBriefObligations(courseId: string) {
  return db
    .select({ label: obligations.label, statement: obligations.statement })
    .from(obligations)
    .where(eq(obligations.courseId, courseId))
    .orderBy(asc(obligations.createdAt));
}

/** Parses the accumulated answers string ("0312") defensively. */
export function parseAnswers(a: string | undefined, max: number): number[] {
  if (!a) return [];
  if (!/^[0-3]*$/.test(a)) return [];
  return a
    .slice(0, max)
    .split("")
    .map((c) => Number(c));
}

export interface MarkResult {
  score: number;
  total: number;
  percent: number;
  passed: boolean;
}

export function markAnswers(
  qs: { correct: number }[],
  answers: number[],
  passMark: number,
): MarkResult {
  const total = qs.length;
  let score = 0;
  qs.forEach((q, i) => {
    if (answers[i] === q.correct) score++;
  });
  const percent = total === 0 ? 0 : Math.round((score / total) * 100);
  return { score, total, percent, passed: percent >= passMark };
}

/**
 * Records a completed run as an append-only ledger row and stamps the
 * assignment completed when passed. Answers are re-marked server-side; the
 * client only ever supplies the picked indexes.
 */
export async function recordAttempt(token: string, answersRaw: string) {
  const ctx = await getAssignmentByToken(token);
  if (!ctx) throw new Error("assignment not found");
  const qs = await getTraineeQuestions(ctx.course.id);
  if (qs.length === 0) throw new Error("course has no approved questions");

  const answers = parseAnswers(answersRaw, qs.length);
  if (answers.length !== qs.length) throw new Error("incomplete answers");

  const mark = markAnswers(qs, answers, ctx.course.passMark);

  const attempt = await appendAttempt({
    orgId: ctx.policy.orgId,
    assignmentId: ctx.assignment.id,
    courseId: ctx.course.id,
    traineePseudonym: ctx.assignment.traineePseudonym,
    answers,
    score: mark.score,
    total: mark.total,
    passed: mark.passed,
  });

  if (mark.passed && !ctx.assignment.completedAt) {
    await db
      .update(assignments)
      .set({ completedAt: attempt.createdAt })
      .where(eq(assignments.id, ctx.assignment.id));
  }

  return { attemptId: attempt.id, ...mark };
}

export async function getAttemptForToken(token: string, attemptId: string) {
  const ctx = await getAssignmentByToken(token);
  if (!ctx) return undefined;
  const attempt = await db.query.attempts.findFirst({
    where: (attempts, { and, eq }) =>
      and(eq(attempts.id, attemptId), eq(attempts.assignmentId, ctx.assignment.id)),
  });
  if (!attempt) return undefined;
  return { attempt, ...ctx };
}
