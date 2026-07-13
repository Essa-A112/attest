import Link from "next/link";
import { notFound } from "next/navigation";
import { getAttemptForToken } from "@/training";

export default async function AttemptResultPage({
  params,
}: {
  params: Promise<{ token: string; attemptId: string }>;
}) {
  const { token, attemptId } = await params;
  const ctx = await getAttemptForToken(token, attemptId);
  if (!ctx) notFound();
  const { attempt, course, policy } = ctx;
  const percent = attempt.total === 0 ? 0 : Math.round((attempt.score / attempt.total) * 100);

  return (
    <main className="container">
      <h1>{policy.title}: your result</h1>
      <p style={{ fontSize: "2rem", margin: "1rem 0" }}>
        {attempt.score} / {attempt.total} ({percent}%)
      </p>
      {attempt.passed ? (
        <>
          <p style={{ color: "#15803d", fontWeight: 600 }}>
            ✓ You passed. Pass mark: {course.passMark}%.
          </p>
          <p>
            Your completion has been recorded in your organisation&apos;s
            tamper-evident training ledger.
          </p>
        </>
      ) : (
        <>
          <p style={{ color: "#b91c1c", fontWeight: 600 }}>
            You didn&apos;t reach the pass mark ({course.passMark}%) this time.
          </p>
          <p>
            Re-read the brief and try again — the policy text is short and the
            questions come straight from it.
          </p>
          <p>
            <Link href={`/t/${token}`}>Review the brief and retake</Link>
          </p>
        </>
      )}
    </main>
  );
}
