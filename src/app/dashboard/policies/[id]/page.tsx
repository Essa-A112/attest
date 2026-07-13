import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgSession } from "@/auth/session";
import { getPolicy } from "@/ingest/policies";

export default async function PolicyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireOrgSession();
  const { id } = await params;
  const policy = await getPolicy(session.orgId, id);
  if (!policy) notFound();

  return (
    <main className="container">
      <p>
        <Link href="/dashboard/policies">&larr; Policies</Link>
      </p>
      <h1>
        {policy.title} <small style={{ color: "var(--muted)" }}>v{policy.version}</small>
      </h1>
      <dl>
        <dt>SHA-256 of policy text</dt>
        <dd style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{policy.sha256}</dd>
        <dt>Source</dt>
        <dd>{policy.sourceKind}</dd>
        <dt>Stored</dt>
        <dd>{policy.createdAt.toISOString()}</dd>
      </dl>
      <h2>Extracted text</h2>
      <pre
        style={{
          whiteSpace: "pre-wrap",
          background: "#f6f6f6",
          padding: "1rem",
          border: "1px solid var(--border)",
          maxHeight: "32rem",
          overflow: "auto",
        }}
      >
        {policy.text}
      </pre>
    </main>
  );
}
