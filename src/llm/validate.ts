/**
 * Programmatic validation for generated questions (the cheap half of pass C).
 * Failing questions are not discarded — they are flagged and land in the
 * review queue; the admin review gate is the final validator.
 */

export interface CandidateQuestion {
  obligation_id: string;
  scenario: string;
  options: string[];
  correct: number;
  rationale: string;
}

export interface FlaggedQuestion extends CandidateQuestion {
  flags: string[];
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

/** Crude Flesch–Kincaid grade estimate; enough to flag dense legalese. */
export function readingGrade(text: string): number {
  const words = text
    .toLowerCase()
    .split(/[^a-z']+/)
    .filter((w) => w.length > 0);
  if (words.length === 0) return 0;
  const sentences = Math.max(1, (text.match(/[.!?]+/g) ?? []).length);
  const syllables = words.reduce((sum, w) => sum + estimateSyllables(w), 0);
  return 0.39 * (words.length / sentences) + 11.8 * (syllables / words.length) - 15.59;
}

function estimateSyllables(word: string): number {
  const clusters = word.replace(/e$/, "").match(/[aeiouy]+/g);
  return Math.max(1, clusters?.length ?? 1);
}

export const READING_GRADE_CAP = 12;
export const SCENARIO_WORD_CAP = 40;

/** Per-question programmatic checks. Returns flag strings; empty = clean. */
export function checkQuestion(
  q: CandidateQuestion,
  knownObligationLabels: Set<string>,
): string[] {
  const flags: string[] = [];

  if (!knownObligationLabels.has(q.obligation_id)) {
    flags.push(`unknown obligation_id "${q.obligation_id}"`);
  }
  if (q.options.length !== 4) {
    flags.push(`expected 4 options, got ${q.options.length}`);
  }
  const normalized = q.options.map((o) => o.trim().toLowerCase());
  if (new Set(normalized).size !== q.options.length) {
    flags.push("options are not distinct");
  }
  if (q.options.some((o) => o.trim().length === 0)) {
    flags.push("empty option");
  }
  if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.options.length) {
    flags.push(`correct index ${q.correct} out of range`);
  }
  const words = countWords(q.scenario);
  if (words >= SCENARIO_WORD_CAP) {
    flags.push(`scenario is ${words} words (cap ${SCENARIO_WORD_CAP})`);
  }
  const grade = readingGrade(q.scenario);
  if (grade > READING_GRADE_CAP) {
    flags.push(`scenario reading grade ${grade.toFixed(1)} exceeds ${READING_GRADE_CAP}`);
  }
  if (q.rationale.trim().length === 0) {
    flags.push("empty rationale");
  }
  return flags;
}

/**
 * Set-level check: correct answers should be roughly uniform across positions.
 * Returns true when one index dominates (>50% of a set of 4+ questions), which
 * triggers a regeneration retry rather than per-question flags.
 */
export function isDistributionSkewed(questions: CandidateQuestion[]): boolean {
  if (questions.length < 4) return false;
  const counts = [0, 0, 0, 0];
  for (const q of questions) {
    if (q.correct >= 0 && q.correct < 4) counts[q.correct] = (counts[q.correct] ?? 0) + 1;
  }
  return Math.max(...counts) > questions.length / 2;
}
