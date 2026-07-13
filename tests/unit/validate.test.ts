import { describe, expect, it } from "vitest";
import {
  checkQuestion,
  countWords,
  isDistributionSkewed,
  readingGrade,
  type CandidateQuestion,
} from "@/llm/validate";

const KNOWN = new Set(["OB-1", "OB-2"]);

function q(partial: Partial<CandidateQuestion> = {}): CandidateQuestion {
  return {
    obligation_id: "OB-1",
    scenario: "A client emails you their card number. What do you do?",
    options: ["Delete it and ask for secure upload", "Save it to notes", "Forward to a colleague", "Print it for the file"],
    correct: 0,
    rationale: 'The policy states: "Card numbers must never be stored in plain text."',
    ...partial,
  };
}

describe("checkQuestion", () => {
  it("passes a clean question", () => {
    expect(checkQuestion(q(), KNOWN)).toEqual([]);
  });

  it("flags unknown obligation ids", () => {
    expect(checkQuestion(q({ obligation_id: "OB-99" }), KNOWN)[0]).toMatch(/unknown obligation/);
  });

  it("flags non-distinct options (case-insensitive)", () => {
    const flags = checkQuestion(
      q({ options: ["Do X", "do x", "Do Y", "Do Z"] }),
      KNOWN,
    );
    expect(flags.some((f) => f.includes("not distinct"))).toBe(true);
  });

  it("flags out-of-range correct index", () => {
    expect(checkQuestion(q({ correct: 4 }), KNOWN).some((f) => f.includes("out of range"))).toBe(true);
    expect(checkQuestion(q({ correct: -1 }), KNOWN).some((f) => f.includes("out of range"))).toBe(true);
  });

  it("flags scenarios at or over the 40-word cap", () => {
    const scenario = Array.from({ length: 45 }, (_, i) => `word${i}`).join(" ");
    expect(checkQuestion(q({ scenario }), KNOWN).some((f) => f.includes("words"))).toBe(true);
  });

  it("flags unreadable scenarios", () => {
    const scenario =
      "Notwithstanding aforementioned organisational contractual responsibilities, systematically internationalisation considerations necessitate comprehensive interdepartmental documentation harmonisation probabilities.";
    expect(readingGrade(scenario)).toBeGreaterThan(12);
    expect(checkQuestion(q({ scenario }), KNOWN).some((f) => f.includes("reading grade"))).toBe(true);
  });
});

describe("countWords / readingGrade", () => {
  it("counts words", () => {
    expect(countWords("one two  three")).toBe(3);
  });
  it("gives plain scenarios a low grade", () => {
    expect(readingGrade("You find a USB drive on your desk. What do you do?")).toBeLessThan(8);
  });
});

describe("isDistributionSkewed", () => {
  it("accepts a spread distribution", () => {
    const set = [q({ correct: 0 }), q({ correct: 1 }), q({ correct: 2 }), q({ correct: 3 })];
    expect(isDistributionSkewed(set)).toBe(false);
  });
  it("rejects a set dominated by one index", () => {
    const set = [q({ correct: 1 }), q({ correct: 1 }), q({ correct: 1 }), q({ correct: 0 }), q({ correct: 1 })];
    expect(isDistributionSkewed(set)).toBe(true);
  });
  it("ignores tiny sets", () => {
    expect(isDistributionSkewed([q(), q()])).toBe(false);
  });
});
