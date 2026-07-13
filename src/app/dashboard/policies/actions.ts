"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/auth/session";
import { createPolicyVersion, ingestPolicyFile } from "@/ingest/policies";

export async function createPolicy(formData: FormData): Promise<void> {
  const session = await requireAdmin();

  const title = formData.get("title");
  if (typeof title !== "string" || title.trim().length === 0) {
    redirect("/dashboard/policies/new?error=Title+is+required");
  }

  const file = formData.get("file");
  const pastedText = formData.get("text");

  let policyId: string;
  if (file instanceof File && file.size > 0) {
    if (file.size > 10 * 1024 * 1024) {
      redirect("/dashboard/policies/new?error=File+too+large+(10MB+max)");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const policy = await ingestPolicyFile({
      orgId: session.orgId,
      title: title.trim(),
      filename: file.name,
      contentType: file.type || null,
      bytes,
    });
    policyId = policy.id;
  } else if (typeof pastedText === "string" && pastedText.trim().length > 0) {
    const policy = await createPolicyVersion({
      orgId: session.orgId,
      title: title.trim(),
      text: pastedText,
      sourceKind: "text",
    });
    policyId = policy.id;
  } else {
    redirect("/dashboard/policies/new?error=Paste+text+or+choose+a+file");
  }

  redirect(`/dashboard/policies/${policyId}`);
}
