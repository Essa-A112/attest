"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/auth/session";
import { publishCourse, PublishError } from "@/courses/publish";

export async function publishAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const courseId = String(formData.get("courseId") ?? "");
  const passMark = Number(formData.get("passMark"));
  const dueAtRaw = String(formData.get("dueAt") ?? "");
  const emails = String(formData.get("emails") ?? "")
    .split(/[\n,;]+/)
    .map((e) => e.trim())
    .filter((e) => e.length > 0);

  try {
    await publishCourse(session.orgId, session.userId, courseId, {
      passMark,
      dueAt: dueAtRaw ? new Date(`${dueAtRaw}T23:59:59Z`) : null,
      emails,
    });
  } catch (err) {
    const message = err instanceof PublishError ? err.message : "publish failed";
    redirect(`/dashboard/courses/${courseId}/publish?error=${encodeURIComponent(message)}`);
  }
  redirect(`/dashboard/courses/${courseId}`);
}
