import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { assignments, attempts, orgs, questions } from "@/db/schema";
import { getCourseForOrg } from "@/courses/queries";
import { verifyChain, type ChainVerification } from "@/ledger/verify";

/**
 * Evidence collection for the per-course-version pack. Outcomes reference
 * pseudonyms only — PII is never joined into anything exported (hard rule).
 */

export interface TraineeOutcome {
  pseudonym: string;
  assignedAt: string;
  dueAt: string | null;
  attemptCount: number;
  bestScore: number | null;
  total: number | null;
  passed: boolean;
  completedAt: string | null;
  lastRowHash: string | null;
}

export interface EvidencePack {
  generatedAt: string;
  org: { name: string };
  policy: { title: string; version: number; sha256: string; sourceKind: string; storedAt: string };
  course: { id: string; passMark: number; status: string };
  questions: {
    scenario: string;
    options: string[];
    correct: number;
    rationale: string;
    sourceQuote: string;
    reviewStatus: string;
  }[];
  outcomes: TraineeOutcome[];
  chain: ChainVerification;
}

export async function collectEvidence(
  orgId: string,
  courseId: string,
): Promise<EvidencePack | undefined> {
  const row = await getCourseForOrg(orgId, courseId);
  if (!row) return undefined;
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, orgId) });
  if (!org) return undefined;

  const approved = await db
    .select()
    .from(questions)
    .where(
      and(
        eq(questions.courseId, courseId),
        inArray(questions.reviewStatus, ["approved", "edited"]),
      ),
    )
    .orderBy(asc(questions.createdAt), asc(questions.id));

  const assignmentRows = await db
    .select()
    .from(assignments)
    .where(eq(assignments.courseId, courseId))
    .orderBy(asc(assignments.createdAt));

  const attemptRows = await db
    .select()
    .from(attempts)
    .where(and(eq(attempts.orgId, orgId), eq(attempts.courseId, courseId)))
    .orderBy(asc(attempts.seq));
  const byAssignment = new Map<string, typeof attemptRows>();
  for (const a of attemptRows) {
    const list = byAssignment.get(a.assignmentId) ?? [];
    list.push(a);
    byAssignment.set(a.assignmentId, list);
  }

  const outcomes: TraineeOutcome[] = assignmentRows.map((a) => {
    const runs = byAssignment.get(a.id) ?? [];
    const best = runs.reduce<(typeof runs)[number] | null>(
      (acc, r) => (acc === null || r.score > acc.score ? r : acc),
      null,
    );
    const last = runs[runs.length - 1] ?? null;
    return {
      pseudonym: a.traineePseudonym,
      assignedAt: a.createdAt.toISOString(),
      dueAt: a.dueAt?.toISOString() ?? null,
      attemptCount: runs.length,
      bestScore: best?.score ?? null,
      total: best?.total ?? null,
      passed: runs.some((r) => r.passed),
      completedAt: a.completedAt?.toISOString() ?? null,
      lastRowHash: last?.rowHash ?? null,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    org: { name: org.name },
    policy: {
      title: row.policy.title,
      version: row.policy.version,
      sha256: row.policy.sha256,
      sourceKind: row.policy.sourceKind,
      storedAt: row.policy.createdAt.toISOString(),
    },
    course: { id: row.course.id, passMark: row.course.passMark, status: row.course.status },
    questions: approved.map((q) => ({
      scenario: q.scenario,
      options: q.options,
      correct: q.correct,
      rationale: q.rationale,
      sourceQuote: q.sourceQuote,
      reviewStatus: q.reviewStatus,
    })),
    outcomes,
    chain: await verifyChain(orgId),
  };
}
