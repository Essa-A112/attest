"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/auth/session";
import {
  approveQuestion,
  editQuestion,
  rejectQuestion,
  ReviewError,
} from "@/courses/review";

function back(courseId: string, error?: string): never {
  const suffix = error ? `?error=${encodeURIComponent(error)}` : "";
  redirect(`/dashboard/courses/${courseId}/review${suffix}`);
}

export async function approveAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const questionId = String(formData.get("questionId") ?? "");
  const courseId = String(formData.get("courseId") ?? "");
  try {
    await approveQuestion(session.orgId, session.userId, questionId);
  } catch (err) {
    back(courseId, err instanceof ReviewError ? err.message : "approve failed");
  }
  back(courseId);
}

export async function rejectAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const questionId = String(formData.get("questionId") ?? "");
  const courseId = String(formData.get("courseId") ?? "");
  try {
    await rejectQuestion(session.orgId, session.userId, questionId);
  } catch (err) {
    back(courseId, err instanceof ReviewError ? err.message : "reject failed");
  }
  back(courseId);
}

export async function editAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const questionId = String(formData.get("questionId") ?? "");
  const courseId = String(formData.get("courseId") ?? "");
  const edit = {
    scenario: String(formData.get("scenario") ?? ""),
    options: [
      String(formData.get("option0") ?? ""),
      String(formData.get("option1") ?? ""),
      String(formData.get("option2") ?? ""),
      String(formData.get("option3") ?? ""),
    ],
    correct: Number(formData.get("correct")),
    rationale: String(formData.get("rationale") ?? ""),
  };
  try {
    await editQuestion(session.orgId, session.userId, questionId, edit);
  } catch (err) {
    back(courseId, err instanceof ReviewError ? err.message : "edit failed");
  }
  back(courseId);
}
