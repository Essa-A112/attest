import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  getAssignmentByToken,
  getTraineeQuestions,
  parseAnswers,
} from "@/training";
import { finishAction } from "./actions";

/**
 * One scenario at a time. Answers accumulate in the `a` query param (one digit
 * per question); marking is always recomputed server-side at the end, so the
 * param is a navigation convenience, not a trust boundary.
 */
export default async function TraineeQuestionPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string; idx: string }>;
  searchParams: Promise<{ a?: string; picked?: string }>;
}) {
  const { token, idx: idxRaw } = await params;
  const { a, picked: pickedRaw } = await searchParams;
  const ctx = await getAssignmentByToken(token);
  if (!ctx) notFound();
  const qs = await getTraineeQuestions(ctx.course.id);
  const idx = Number(idxRaw);
  if (!Number.isInteger(idx) || idx < 0 || idx >= qs.length) notFound();
  const question = qs[idx];
  if (!question) notFound();

  const answers = parseAnswers(a, qs.length);
  if (answers.length < idx) redirect(`/t/${token}/q/${answers.length}?a=${answers.join("")}`);

  const picked = pickedRaw !== undefined ? Number(pickedRaw) : undefined;
  const inFeedback =
    picked !== undefined && Number.isInteger(picked) && picked >= 0 && picked <= 3;

  if (!inFeedback) {
    // Answer mode: plain GET form so the browser back button stays sane.
    return (
      <main className="container">
        <p style={{ color: "var(--muted)" }}>
          Question {idx + 1} of {qs.length} &middot; {ctx.policy.title}
        </p>
        <h1 style={{ fontSize: "1.3rem" }}>{question.scenario}</h1>
        <form method="GET">
          <input type="hidden" name="a" value={answers.slice(0, idx).join("")} />
          {question.options.map((opt, i) => (
            <p key={i}>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "baseline" }}>
                <input type="radio" name="picked" value={i} required /> {opt}
              </label>
            </p>
          ))}
          <button type="submit" style={{ padding: "0.5rem 1rem" }}>
            Submit answer
          </button>
        </form>
      </main>
    );
  }

  // Feedback mode: instant marking with the clause quoted back.
  const correct = picked === question.correct;
  const nextAnswers = [...answers.slice(0, idx), picked].join("");
  const isLast = idx === qs.length - 1;

  return (
    <main className="container">
      <p style={{ color: "var(--muted)" }}>
        Question {idx + 1} of {qs.length} &middot; {ctx.policy.title}
      </p>
      <h1 style={{ fontSize: "1.3rem" }}>{question.scenario}</h1>
      <p>
        Your answer: <em>{question.options[picked]}</em>
      </p>
      {correct ? (
        <p style={{ color: "#15803d", fontWeight: 600 }}>✓ Correct.</p>
      ) : (
        <>
          <p style={{ color: "#b91c1c", fontWeight: 600 }}>✗ Not quite.</p>
          <p>
            The compliant choice is: <em>{question.options[question.correct]}</em>
          </p>
        </>
      )}
      <p>{question.rationale}</p>
      <blockquote
        style={{
          margin: "1rem 0",
          padding: "0.5rem 0.75rem",
          borderLeft: "3px solid var(--accent)",
          background: "#f8fafc",
        }}
      >
        The policy says: &ldquo;{question.sourceQuote}&rdquo;
      </blockquote>
      {isLast ? (
        <form action={finishAction}>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="answers" value={nextAnswers} />
          <button type="submit" style={{ padding: "0.6rem 1.2rem" }}>
            Finish and record my result
          </button>
        </form>
      ) : (
        <Link href={`/t/${token}/q/${idx + 1}?a=${nextAnswers}`}>Next question &rarr;</Link>
      )}
    </main>
  );
}
