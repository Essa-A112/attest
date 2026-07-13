import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgSession } from "@/auth/session";
import { getCourseForOrg, listObligations, listQuestions } from "@/courses/queries";
import { canPublish, reviewSummary } from "@/courses/review";
import { publishCourseAction } from "../actions";

export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireOrgSession();
  const { id } = await params;
  const { error } = await searchParams;
  const row = await getCourseForOrg(session.orgId, id);
  if (!row) notFound();
  const { course, policy } = row;
  const obligationRows = await listObligations(course.id);
  const questionRows = await listQuestions(course.id);
  const summary = await reviewSummary(course.id);
  const pendingCount = summary.pending;
  const flaggedCount = questionRows.filter((q) => q.checkFlags.length > 0).length;
  const publishable = canPublish(summary) && course.status === "draft";

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

      {error ? (
        <p role="alert" style={{ color: "#b91c1c" }}>
          {error}
        </p>
      ) : null}

      <h2>Questions ({questionRows.length})</h2>
      {questionRows.length > 0 ? (
        <>
          <p>
            {pendingCount} pending &middot; {summary.approved} approved &middot;{" "}
            {summary.edited} edited &middot; {summary.rejected} rejected
            {flaggedCount > 0 ? <> &middot; {flaggedCount} flagged by checks</> : null}
          </p>
          {session.role === "admin" && course.status === "draft" ? (
            <p>
              <Link href={`/dashboard/courses/${course.id}/review`}>
                Review questions
              </Link>
            </p>
          ) : null}
          {session.role === "admin" ? (
            <form action={publishCourseAction}>
              <input type="hidden" name="courseId" value={course.id} />
              <button
                type="submit"
                disabled={!publishable}
                title={
                  publishable
                    ? "Publish this course"
                    : pendingCount > 0
                      ? `${pendingCount} question(s) still pending review`
                      : course.status !== "draft"
                        ? "course is not a draft"
                        : "at least one approved question is required"
                }
                style={{
                  padding: "0.5rem 1rem",
                  opacity: publishable ? 1 : 0.5,
                  cursor: publishable ? "pointer" : "not-allowed",
                }}
              >
                Publish course
              </button>
              {!publishable && pendingCount > 0 ? (
                <span style={{ marginLeft: "0.75rem", color: "var(--muted)" }}>
                  Blocked: {pendingCount} question(s) awaiting review.
                </span>
              ) : null}
            </form>
          ) : null}
        </>
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
