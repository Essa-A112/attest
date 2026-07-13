import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgSession } from "@/auth/session";
import { listCoursesForPolicy } from "@/courses/queries";
import { getPolicy } from "@/ingest/policies";
import { createCourseFromPolicy } from "../../courses/actions";

export default async function PolicyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireOrgSession();
  const { id } = await params;
  const policy = await getPolicy(session.orgId, id);
  if (!policy) notFound();
  const courseRows = await listCoursesForPolicy(session.orgId, policy.id);

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
      <h2>Courses</h2>
      {courseRows.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>No courses generated yet.</p>
      ) : (
        <ul>
          {courseRows.map(({ course }) => (
            <li key={course.id}>
              <Link href={`/dashboard/courses/${course.id}`}>
                Course v{course.version}
              </Link>{" "}
              &mdash; {course.status} / generation {course.generationStatus}
            </li>
          ))}
        </ul>
      )}
      {session.role === "admin" ? (
        <form action={createCourseFromPolicy}>
          <input type="hidden" name="policyId" value={policy.id} />
          <button type="submit" style={{ padding: "0.5rem 1rem" }}>
            Generate course from this policy
          </button>
        </form>
      ) : null}

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
