import { auth } from "@/auth";
import { collectEvidence } from "@/evidence/collect";
import { buildEvidencePdf } from "@/evidence/render";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.orgId) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;

  const pack = await collectEvidence(session.user.orgId, id);
  if (!pack) return new Response("Not found", { status: 404 });

  const pdf = await buildEvidencePdf(pack);
  const filename = `attest-evidence-${pack.policy.title.replaceAll(/[^a-zA-Z0-9-]/g, "_")}-v${pack.policy.version}.pdf`;
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
