import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/auth/session";
import { getCourseForOrg } from "@/courses/queries";
import { canPublish, reviewSummary } from "@/courses/review";
import { publishAction } from "./actions";

export default async function PublishPage({
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
  const summary = await reviewSummary(course.id);
  const publishable = canPublish(summary) && course.status === "draft";

  return (
    <main className="container">
      <p>
        <Link href={`/dashboard/courses/${course.id}`}>&larr; Course</Link>
      </p>
      <h1>
        Publish: {policy.title}{" "}
        <small style={{ color: "var(--muted)" }}>v{course.version}</small>
      </h1>
      {!publishable ? (
        <p role="alert" style={{ color: "#b91c1c" }}>
          {course.status !== "draft"
            ? "This course is already published."
            : summary.pending > 0
              ? `Blocked: ${summary.pending} question(s) still pending review.`
              : "Blocked: at least one approved question is required."}
        </p>
      ) : null}
      {error ? (
        <p role="alert" style={{ color: "#b91c1c" }}>
          {error}
        </p>
      ) : null}
      <form action={publishAction}>
        <input type="hidden" name="courseId" value={course.id} />
        <p>
          <label htmlFor="passMark">Pass mark (%)</label>
          <br />
          <input
            id="passMark"
            name="passMark"
            type="number"
            min={1}
            max={100}
            defaultValue={course.passMark}
            style={{ padding: "0.5rem", width: "6rem" }}
          />
        </p>
        <p>
          <label htmlFor="dueAt">Due date (optional)</label>
          <br />
          <input id="dueAt" name="dueAt" type="date" style={{ padding: "0.5rem" }} />
        </p>
        <p>
          <label htmlFor="emails">Trainee emails (one per line)</label>
          <br />
          <textarea
            id="emails"
            name="emails"
            rows={8}
            required
            placeholder={"jane@example.com\nsam@example.com"}
            style={{ width: "100%", maxWidth: "28rem", padding: "0.5rem" }}
          />
        </p>
        <button type="submit" disabled={!publishable} style={{ padding: "0.5rem 1rem" }}>
          Publish and send magic links
        </button>
      </form>
    </main>
  );
}
