import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgSession } from "@/auth/session";
import { getCourseForOrg, listObligations } from "@/courses/queries";

export default async function CoursePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireOrgSession();
  const { id } = await params;
  const row = await getCourseForOrg(session.orgId, id);
  if (!row) notFound();
  const { course, policy } = row;
  const obligationRows = await listObligations(course.id);

  const inProgress = ["pending", "extracting", "generating", "checking"].includes(
    course.generationStatus,
  );

  return (
    <main className="container">
      {inProgress ? <meta httpEquiv="refresh" content="3" /> : null}
      <p>
        <Link href={`/dashboard/policies/${policy.id}`}>&larr; {policy.title}</Link>
      </p>
      <h1>
        Course: {policy.title}{" "}
        <small style={{ color: "var(--muted)" }}>v{course.version}</small>
      </h1>
      <p>
        Status: <strong>{course.status}</strong> &middot; Generation:{" "}
        <strong>{course.generationStatus}</strong>
        {course.generationError ? (
          <span style={{ color: "#b91c1c" }}> ({course.generationError})</span>
        ) : null}
      </p>
      {inProgress ? (
        <p style={{ color: "var(--muted)" }}>
          Working&hellip; this page refreshes automatically.
        </p>
      ) : null}

      <h2>Obligations ({obligationRows.length})</h2>
      {obligationRows.length === 0 && !inProgress ? (
        <p style={{ color: "var(--muted)" }}>No obligations extracted.</p>
      ) : (
        <ol>
          {obligationRows.map((ob) => (
            <li key={ob.id} style={{ marginBottom: "1rem" }}>
              <p style={{ margin: "0 0 0.25rem" }}>
                <strong>{ob.label}:</strong> {ob.statement}
              </p>
              <blockquote
                style={{
                  margin: 0,
                  padding: "0.25rem 0.75rem",
                  borderLeft: "3px solid var(--border)",
                  color: "var(--muted)",
                }}
              >
                &ldquo;{ob.quote}&rdquo;{" "}
                <small>
                  [chars {ob.offsets[0]}&ndash;{ob.offsets[1]}]
                </small>
              </blockquote>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
