import Link from "next/link";
import { requireOrgSession } from "@/auth/session";
import { listPolicies } from "@/ingest/policies";

export default async function PoliciesPage() {
  const session = await requireOrgSession();
  const rows = await listPolicies(session.orgId);

  return (
    <main className="container">
      <p>
        <Link href="/dashboard">&larr; Dashboard</Link>
      </p>
      <h1>Policies</h1>
      {session.role === "admin" ? (
        <p>
          <Link href="/dashboard/policies/new">Add a policy</Link>
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>No policies yet.</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>Title</th>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>Version</th>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>Source</th>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>SHA-256</th>
              <th style={{ textAlign: "left", padding: "0.5rem" }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "0.5rem" }}>
                  <Link href={`/dashboard/policies/${p.id}`}>{p.title}</Link>
                </td>
                <td style={{ padding: "0.5rem" }}>v{p.version}</td>
                <td style={{ padding: "0.5rem" }}>{p.sourceKind}</td>
                <td style={{ padding: "0.5rem", fontFamily: "monospace" }}>
                  {p.sha256.slice(0, 12)}&hellip;
                </td>
                <td style={{ padding: "0.5rem" }}>
                  {p.createdAt.toISOString().slice(0, 10)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
