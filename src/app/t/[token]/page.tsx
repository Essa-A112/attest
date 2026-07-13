import Link from "next/link";
import { notFound } from "next/navigation";
import { getAssignmentByToken, getBriefObligations, getTraineeQuestions } from "@/training";

export default async function TraineeBriefPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const ctx = await getAssignmentByToken(token);
  if (!ctx) notFound();
  const brief = await getBriefObligations(ctx.course.id);
  const qs = await getTraineeQuestions(ctx.course.id);

  return (
    <main className="container">
      <h1>{ctx.policy.title}</h1>
      {ctx.assignment.completedAt ? (
        <p style={{ color: "#15803d" }}>
          ✓ You completed this training on{" "}
          {ctx.assignment.completedAt.toDateString()}. You can retake it below.
        </p>
      ) : null}
      {ctx.assignment.dueAt ? (
        <p style={{ color: "var(--muted)" }}>
          Due by {ctx.assignment.dueAt.toDateString()}.
        </p>
      ) : null}
      <p>
        This short training checks you understand your organisation&apos;s
        policy. Read the key obligations below, then answer {qs.length}{" "}
        scenario question{qs.length === 1 ? "" : "s"}. Pass mark:{" "}
        {ctx.course.passMark}%.
      </p>
      <h2>What the policy requires of you</h2>
      <ol>
        {brief.map((ob) => (
          <li key={ob.label} style={{ marginBottom: "0.5rem" }}>
            {ob.statement}
          </li>
        ))}
      </ol>
      <p>
        <Link
          href={`/t/${token}/q/0`}
          style={{
            display: "inline-block",
            padding: "0.6rem 1.2rem",
            background: "var(--accent)",
            color: "white",
            borderRadius: "4px",
            textDecoration: "none",
          }}
        >
          {ctx.assignment.completedAt ? "Retake the questions" : "Start the questions"}
        </Link>
      </p>
    </main>
  );
}
