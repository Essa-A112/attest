import { auth } from "@/auth";
import { collectEvidence } from "@/evidence/collect";
import { buildEvidenceCsv } from "@/evidence/render";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.orgId) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;

  const pack = await collectEvidence(session.user.orgId, id);
  if (!pack) return new Response("Not found", { status: 404 });

  const csv = buildEvidenceCsv(pack);
  const filename = `attest-outcomes-${pack.policy.title.replaceAll(/[^a-zA-Z0-9-]/g, "_")}-v${pack.policy.version}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
