"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { courses } from "@/db/schema";
import { requireAdmin } from "@/auth/session";
import { getCourseForOrg } from "@/courses/queries";
import { canPublish, reviewSummary } from "@/courses/review";
import { logEvent } from "@/events";
import { getPolicy } from "@/ingest/policies";
import { enqueueCourseGeneration } from "@/jobs";

export async function createCourseFromPolicy(formData: FormData): Promise<void> {
  const session = await requireAdmin();

  const policyId = formData.get("policyId");
  if (typeof policyId !== "string") redirect("/dashboard/policies");

  // Org scoping: the policy lookup is already org-filtered.
  const policy = await getPolicy(session.orgId, policyId);
  if (!policy) redirect("/dashboard/policies");

  const [course] = await db
    .insert(courses)
    .values({
      policyId: policy.id,
      version: policy.version,
      createdBy: session.userId,
    })
    .returning();
  if (!course) throw new Error("course insert failed");

  await enqueueCourseGeneration(course.id);
  redirect(`/dashboard/courses/${course.id}`);
}

/**
 * Publishing is blocked server-side while any question is pending (hard rule:
 * the review gate is mandatory). The disabled button in the UI is cosmetic;
 * this check is the enforcement.
 */
export async function publishCourseAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const courseId = String(formData.get("courseId") ?? "");

  const row = await getCourseForOrg(session.orgId, courseId);
  if (!row) redirect("/dashboard/policies");
  if (row.course.status !== "draft") {
    redirect(`/dashboard/courses/${courseId}?error=${encodeURIComponent("course is not a draft")}`);
  }

  const summary = await reviewSummary(courseId);
  if (!canPublish(summary)) {
    redirect(
      `/dashboard/courses/${courseId}?error=${encodeURIComponent(
        summary.pending > 0
          ? `cannot publish: ${summary.pending} question(s) still pending review`
          : "cannot publish: the course needs at least one approved question",
      )}`,
    );
  }

  await db.update(courses).set({ status: "published" }).where(eq(courses.id, courseId));
  await logEvent({
    orgId: session.orgId,
    actor: session.userId,
    action: "course.published",
    subject: `course:${courseId}`,
  });
  redirect(`/dashboard/courses/${courseId}`);
}
