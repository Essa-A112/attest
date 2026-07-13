import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { courses, policies, questions } from "@/db/schema";
import { logEvent } from "@/events";

/**
 * The review gate. No AI-generated question reaches a trainee until an admin
 * has approved (or edited) it here, and a course cannot publish while any
 * question is pending. Enforced server-side; the UI state is a convenience.
 */

export class ReviewError extends Error {}

/** Loads a question only if its course belongs to the org. */
async function getQuestionForOrg(orgId: string, questionId: string) {
  const [row] = await db
    .select({ question: questions, course: courses })
    .from(questions)
    .innerJoin(courses, eq(questions.courseId, courses.id))
    .innerJoin(policies, eq(courses.policyId, policies.id))
    .where(and(eq(questions.id, questionId), eq(policies.orgId, orgId)));
  return row;
}

function assertDraft(course: { status: string }) {
  if (course.status !== "draft") {
    throw new ReviewError("questions can only be reviewed while the course is a draft");
  }
}

export async function approveQuestion(orgId: string, actor: string, questionId: string) {
  const row = await getQuestionForOrg(orgId, questionId);
  if (!row) throw new ReviewError("question not found");
  assertDraft(row.course);
  await db
    .update(questions)
    .set({ reviewStatus: "approved" })
    .where(eq(questions.id, questionId));
  await logEvent({ orgId, actor, action: "question.approved", subject: `question:${questionId}` });
}

export async function rejectQuestion(orgId: string, actor: string, questionId: string) {
  const row = await getQuestionForOrg(orgId, questionId);
  if (!row) throw new ReviewError("question not found");
  assertDraft(row.course);
  await db
    .update(questions)
    .set({ reviewStatus: "rejected" })
    .where(eq(questions.id, questionId));
  await logEvent({ orgId, actor, action: "question.rejected", subject: `question:${questionId}` });
}

export interface QuestionEdit {
  scenario: string;
  options: string[];
  correct: number;
  rationale: string;
}

/** Basic integrity is still enforced on edits; content quality is the
 * admin's call — that is the point of the gate. */
export function validateEdit(edit: QuestionEdit): string | null {
  if (edit.scenario.trim().length === 0) return "scenario is required";
  if (edit.options.length !== 4) return "exactly 4 options are required";
  if (edit.options.some((o) => o.trim().length === 0)) return "options cannot be empty";
  const normalized = edit.options.map((o) => o.trim().toLowerCase());
  if (new Set(normalized).size !== 4) return "options must be distinct";
  if (!Number.isInteger(edit.correct) || edit.correct < 0 || edit.correct > 3) {
    return "correct answer must be one of the 4 options";
  }
  if (edit.rationale.trim().length === 0) return "rationale is required";
  return null;
}

export async function editQuestion(
  orgId: string,
  actor: string,
  questionId: string,
  edit: QuestionEdit,
) {
  const row = await getQuestionForOrg(orgId, questionId);
  if (!row) throw new ReviewError("question not found");
  assertDraft(row.course);
  const problem = validateEdit(edit);
  if (problem) throw new ReviewError(problem);
  await db
    .update(questions)
    .set({
      scenario: edit.scenario.trim(),
      options: edit.options.map((o) => o.trim()),
      correct: edit.correct,
      rationale: edit.rationale.trim(),
      reviewStatus: "edited",
    })
    .where(eq(questions.id, questionId));
  await logEvent({ orgId, actor, action: "question.edited", subject: `question:${questionId}` });
}

export interface ReviewSummary {
  total: number;
  pending: number;
  approved: number;
  edited: number;
  rejected: number;
}

export async function reviewSummary(courseId: string): Promise<ReviewSummary> {
  const rows = await db
    .select({ reviewStatus: questions.reviewStatus })
    .from(questions)
    .where(eq(questions.courseId, courseId));
  const summary: ReviewSummary = { total: rows.length, pending: 0, approved: 0, edited: 0, rejected: 0 };
  for (const r of rows) summary[r.reviewStatus] += 1;
  return summary;
}

/** Publishing is blocked while ANY question is pending, and a course with no
 * approved content cannot publish either. */
export function canPublish(summary: ReviewSummary): boolean {
  return summary.total > 0 && summary.pending === 0 && summary.approved + summary.edited > 0;
}
