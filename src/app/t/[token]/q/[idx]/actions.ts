"use server";

import { redirect } from "next/navigation";
import { recordAttempt } from "@/training";

/** Records the attempt exactly once (redirect-after-POST), so a refresh of the
 * result page cannot append duplicate ledger rows. */
export async function finishAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const answers = String(formData.get("answers") ?? "");
  let attemptId: string;
  try {
    const result = await recordAttempt(token, answers);
    attemptId = result.attemptId;
  } catch {
    // Token invalid or answers incomplete: back to the brief. No details leak.
    redirect(`/t/${token}`);
  }
  redirect(`/t/${token}/attempts/${attemptId}`);
}
