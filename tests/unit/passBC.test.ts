import { describe, expect, it } from "vitest";
import type { VerifiedObligation } from "@/llm/passA";
import { PassFailedError } from "@/llm/passA";
import { runPassB } from "@/llm/passB";
import { runPassC } from "@/llm/passC";
import { ScriptedProvider } from "@/llm/provider";

const OBLIGATIONS: VerifiedObligation[] = [
  {
    id: "OB-1",
    statement: "Report breaches within 24 hours.",
    quote: "Breaches must be reported within 24 hours.",
    offsets: [0, 42],
  },
  {
    id: "OB-2",
    statement: "Never share passwords.",
    quote: "Passwords must never be shared.",
    offsets: [43, 74],
  },
];

function goodQuestions() {
  return {
    questions: [
      {
        obligation_id: "OB-1",
        scenario: "You spot a lost customer file at 5pm on Friday. What do you do?",
        options: ["Report it now", "Wait until Monday", "Shred it quietly", "Email it to yourself"],
        correct: 0,
        rationale: 'The policy says: "Breaches must be reported within 24 hours."',
      },
      {
        obligation_id: "OB-2",
        scenario: "A teammate on deadline asks for your login. What do you do?",
        options: ["Share it just once", "Decline and suggest access request", "Write it on a sticky note", "Log in for them and walk away"],
        correct: 1,
        rationale: 'The policy says: "Passwords must never be shared."',
      },
    ],
  };
}

describe("runPassB", () => {
  it("returns validated questions with empty flags when clean", async () => {
    const provider = new ScriptedProvider([JSON.stringify(goodQuestions())]);
    const { questions, runs } = await runPassB(provider, OBLIGATIONS);
    expect(questions).toHaveLength(2);
    expect(questions.every((q) => q.flags.length === 0)).toBe(true);
    expect(runs).toHaveLength(1);
    expect(provider.requests[0]?.kind).toBe("passB");
  });

  it("flags questions that fail programmatic checks instead of discarding them", async () => {
    const bad = goodQuestions();
    const first = bad.questions[0];
    if (!first) throw new Error("fixture");
    first.options = ["Same", "same", "Other", "Else"];
    const provider = new ScriptedProvider([JSON.stringify(bad)]);
    const { questions } = await runPassB(provider, OBLIGATIONS);
    expect(questions).toHaveLength(2);
    expect(questions[0]?.flags.some((f) => f.includes("not distinct"))).toBe(true);
    expect(questions[1]?.flags).toEqual([]);
  });

  it("retries on schema failure then succeeds", async () => {
    const provider = new ScriptedProvider([
      "not json at all",
      JSON.stringify(goodQuestions()),
    ]);
    const { questions, runs } = await runPassB(provider, OBLIGATIONS);
    expect(questions).toHaveLength(2);
    expect(runs).toHaveLength(2);
  });

  it("throws PassFailedError after two retries", async () => {
    const empty = JSON.stringify({ questions: [] });
    const provider = new ScriptedProvider([empty, empty, empty]);
    await expect(runPassB(provider, OBLIGATIONS)).rejects.toThrow(PassFailedError);
  });
});

describe("runPassC", () => {
  const byLabel = new Map(OBLIGATIONS.map((ob) => [ob.id, ob]));

  it("adds checker flags for failing questions and notes for all", async () => {
    const { questions } = await runPassB(
      new ScriptedProvider([JSON.stringify(goodQuestions())]),
      OBLIGATIONS,
    );
    const provider = new ScriptedProvider([
      JSON.stringify({
        results: [
          { index: 0, keyed_answer_follows: true, distractors_defensible: true, notes: "fine" },
          { index: 1, keyed_answer_follows: false, distractors_defensible: true, notes: "answer needs outside knowledge" },
        ],
      }),
    ]);
    const checked = await runPassC(provider, questions, byLabel);
    expect(checked.questions[0]?.flags).toEqual([]);
    expect(checked.questions[1]?.flags.some((f) => f.includes("keyed answer"))).toBe(true);
    expect(checked.questions[1]?.checkerNotes).toContain("outside knowledge");
    expect(provider.requests[0]?.model).toBeTruthy();
  });

  it("flags questions the checker skipped", async () => {
    const { questions } = await runPassB(
      new ScriptedProvider([JSON.stringify(goodQuestions())]),
      OBLIGATIONS,
    );
    const provider = new ScriptedProvider([
      JSON.stringify({
        results: [
          { index: 0, keyed_answer_follows: true, distractors_defensible: true, notes: "" },
        ],
      }),
    ]);
    const checked = await runPassC(provider, questions, byLabel);
    expect(checked.questions[1]?.flags.some((f) => f.includes("no verdict"))).toBe(true);
  });
});
