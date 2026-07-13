"use server";

import { redirect } from "next/navigation";
import { db } from "@/db";
import { courses } from "@/db/schema";
import { requireAdmin } from "@/auth/session";
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
