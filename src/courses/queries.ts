import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { courses, obligations, policies, questions } from "@/db/schema";

/**
 * Courses carry no org_id; tenancy flows through the policy they were built
 * from. Every course read joins policies and filters by org — no exceptions.
 */
export async function getCourseForOrg(orgId: string, courseId: string) {
  const [row] = await db
    .select({ course: courses, policy: policies })
    .from(courses)
    .innerJoin(policies, eq(courses.policyId, policies.id))
    .where(and(eq(courses.id, courseId), eq(policies.orgId, orgId)));
  return row;
}

export async function listCoursesForOrg(orgId: string) {
  return db
    .select({ course: courses, policy: policies })
    .from(courses)
    .innerJoin(policies, eq(courses.policyId, policies.id))
    .where(eq(policies.orgId, orgId))
    .orderBy(desc(courses.createdAt));
}

export async function listCoursesForPolicy(orgId: string, policyId: string) {
  return db
    .select({ course: courses })
    .from(courses)
    .innerJoin(policies, eq(courses.policyId, policies.id))
    .where(and(eq(policies.id, policyId), eq(policies.orgId, orgId)))
    .orderBy(desc(courses.createdAt));
}

export async function listObligations(courseId: string) {
  return db
    .select()
    .from(obligations)
    .where(eq(obligations.courseId, courseId))
    .orderBy(obligations.createdAt);
}

export async function listQuestions(courseId: string) {
  return db
    .select()
    .from(questions)
    .where(eq(questions.courseId, courseId))
    .orderBy(questions.createdAt);
}
