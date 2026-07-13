import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/auth/session";
import { getCourseForOrg, listQuestions } from "@/courses/queries";
import { reviewSummary, canPublish } from "@/courses/review";
import { approveAction, editAction, rejectAction } from "./actions";

const statusColors: Record<string, string> = {
  pending: "#b45309",
  approved: "#15803d",
  edited: "#15803d",
  rejected: "#6b7280",
};

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireAdmin();
  const { id } = await params;
  const { error } = await searchParams;
  const row = await getCourseForOrg(session.orgId, id);
  if (!row) notFound();
  const { course, policy } = row;
  const questionRows = await listQuestions(course.id);
  const summary = await reviewSummary(course.id);
  const publishable = canPublish(summary);

  return (
    <main className="container" style={{ maxWidth: "52rem" }}>
      <p>
        <Link href={`/dashboard/courses/${course.id}`}>&larr; Course</Link>
      </p>
      <h1>
        Review: {policy.title}{" "}
        <small style={{ color: "var(--muted)" }}>v{course.version}</small>
      </h1>
      <p>
        {summary.pending} pending &middot; {summary.approved} approved &middot;{" "}
        {summary.edited} edited &middot; {summary.rejected} rejected
      </p>
      <p style={{ color: "var(--muted)" }}>
        Every question must be approved, edited, or rejected before this course
        can publish. Nothing reaches a trainee until you sign it off.
      </p>
      {error ? (
        <p role="alert" style={{ color: "#b91c1c" }}>
          {error}
        </p>
      ) : null}
      {!publishable && summary.pending === 0 && summary.total > 0 ? (
        <p role="alert" style={{ color: "#b91c1c" }}>
          All questions are rejected — a course needs at least one approved
          question to publish.
        </p>
      ) : null}

      {questionRows.map((q, idx) => (
        <section
          key={q.id}
          style={{
            border: "1px solid var(--border)",
            borderRadius: "6px",
            padding: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          <p style={{ marginTop: 0 }}>
            <strong>Q{idx + 1}</strong>{" "}
            <span style={{ color: statusColors[q.reviewStatus] }}>
              [{q.reviewStatus}]
            </span>
          </p>
          {q.checkFlags.length > 0 ? (
            <p style={{ color: "#b45309" }}>
              ⚑ Flagged by checks:
              <br />
              {q.checkFlags.map((f) => (
                <span key={f}>
                  &nbsp;&nbsp;&bull; {f}
                  <br />
                </span>
              ))}
            </p>
          ) : null}
          {q.checkerNotes ? (
            <p style={{ color: "var(--muted)" }}>Checker notes: {q.checkerNotes}</p>
          ) : null}
          <blockquote
            style={{
              margin: "0 0 1rem",
              padding: "0.25rem 0.75rem",
              borderLeft: "3px solid var(--border)",
              color: "var(--muted)",
            }}
          >
            Policy clause: &ldquo;{q.sourceQuote}&rdquo;
          </blockquote>

          <form action={editAction}>
            <input type="hidden" name="questionId" value={q.id} />
            <input type="hidden" name="courseId" value={course.id} />
            <p>
              <label htmlFor={`scenario-${q.id}`}>Scenario</label>
              <br />
              <textarea
                id={`scenario-${q.id}`}
                name="scenario"
                defaultValue={q.scenario}
                rows={3}
                style={{ width: "100%", padding: "0.5rem" }}
              />
            </p>
            {q.options.map((opt, i) => (
              <p key={i} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="radio"
                  name="correct"
                  value={i}
                  defaultChecked={q.correct === i}
                  aria-label={`Mark option ${i + 1} correct`}
                />
                <input
                  name={`option${i}`}
                  defaultValue={opt}
                  style={{ flex: 1, padding: "0.5rem" }}
                />
              </p>
            ))}
            <p>
              <label htmlFor={`rationale-${q.id}`}>Rationale</label>
              <br />
              <textarea
                id={`rationale-${q.id}`}
                name="rationale"
                defaultValue={q.rationale}
                rows={2}
                style={{ width: "100%", padding: "0.5rem" }}
              />
            </p>
            <button type="submit" style={{ padding: "0.4rem 0.8rem" }}>
              Save changes &amp; approve as edited
            </button>
          </form>

          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
            <form action={approveAction}>
              <input type="hidden" name="questionId" value={q.id} />
              <input type="hidden" name="courseId" value={course.id} />
              <button type="submit" style={{ padding: "0.4rem 0.8rem", background: "#dcfce7" }}>
                Approve as-is
              </button>
            </form>
            <form action={rejectAction}>
              <input type="hidden" name="questionId" value={q.id} />
              <input type="hidden" name="courseId" value={course.id} />
              <button type="submit" style={{ padding: "0.4rem 0.8rem", background: "#fee2e2" }}>
                Reject
              </button>
            </form>
          </div>
        </section>
      ))}
    </main>
  );
}
