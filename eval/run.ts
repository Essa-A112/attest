// Eval harness: runs the full generation pipeline (passes A, B, C) against the
// golden set and scores each policy on the four-axis rubric, reporting drift
// against the checked-in baseline.
//
// Usage:
//   pnpm eval                     # run + drift report (exit 1 on pipeline failure)
//   pnpm eval --update-baseline   # additionally rewrite eval/baseline.json
//
// The golden set never shrinks: removing a policy that exists in the baseline
// fails the run (and the golden-set unit test).
import "dotenv/config";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { judgeQuestionSet, rubricAxes, type RubricScores } from "../src/llm/judge";
import { runPassA } from "../src/llm/passA";
import { runPassB } from "../src/llm/passB";
import { runPassC } from "../src/llm/passC";
import { getProvider } from "../src/llm/provider";
import { isDistributionSkewed, readingGrade, countWords } from "../src/llm/validate";
import { normalizeText } from "../src/ingest/extract";

const GOLDEN_DIR = path.join(process.cwd(), "eval", "golden");
const BASELINE_PATH = path.join(process.cwd(), "eval", "baseline.json");
const LAST_RUN_PATH = path.join(process.cwd(), "eval", "last-run.json");

interface PolicyResult {
  slug: string;
  obligations: number;
  droppedObligations: number;
  questions: number;
  flaggedPct: number;
  avgScenarioWords: number;
  avgReadingGrade: number;
  distributionSkewed: boolean;
  rubric: RubricScores;
}

interface EvalReport {
  provider: string;
  ranAt: string;
  results: PolicyResult[];
}

function loadGolden(): { slug: string; title: string; text: string }[] {
  return readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((file) => {
      const raw = readFileSync(path.join(GOLDEN_DIR, file), "utf8");
      const title = raw.split("\n")[0]?.replace(/^#\s*/, "") ?? file;
      return { slug: file.replace(/\.md$/, ""), title, text: normalizeText(raw) };
    });
}

function round(n: number, dp = 1): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

async function evalPolicy(
  provider: Awaited<ReturnType<typeof getProvider>>,
  policy: { slug: string; text: string },
): Promise<PolicyResult> {
  const passA = await runPassA(provider, policy.text);
  const passB = await runPassB(provider, passA.obligations);
  const byLabel = new Map(passA.obligations.map((o) => [o.id, o]));
  const passC = await runPassC(provider, passB.questions, byLabel);

  const qs = passC.questions;
  const flagged = qs.filter((q) => q.flags.length > 0).length;
  const rubric = await judgeQuestionSet(provider, passA.obligations, qs);

  return {
    slug: policy.slug,
    obligations: passA.obligations.length,
    droppedObligations: passA.droppedCount,
    questions: qs.length,
    flaggedPct: qs.length === 0 ? 0 : round((flagged / qs.length) * 100),
    avgScenarioWords: round(
      qs.reduce((sum, q) => sum + countWords(q.scenario), 0) / Math.max(1, qs.length),
    ),
    avgReadingGrade: round(
      qs.reduce((sum, q) => sum + readingGrade(q.scenario), 0) / Math.max(1, qs.length),
    ),
    distributionSkewed: isDistributionSkewed(qs),
    rubric,
  };
}

function printTable(report: EvalReport, baseline: EvalReport | null) {
  const compare = baseline && baseline.provider === report.provider;
  console.log(`\nAttest eval — provider: ${report.provider} — ${report.ranAt}`);
  if (baseline && !compare) {
    console.log(
      `(baseline was recorded with provider "${baseline.provider}"; drift not comparable)`,
    );
  }
  const header = [
    "policy".padEnd(16),
    "obl".padStart(4),
    "qs".padStart(3),
    "flag%".padStart(6),
    "words".padStart(6),
    "grade".padStart(6),
    ...rubricAxes.map((a) => a.slice(0, 8).padStart(9)),
  ].join(" ");
  console.log(header);
  console.log("-".repeat(header.length));

  for (const r of report.results) {
    const base = baseline?.results.find((b) => b.slug === r.slug);
    const drift = (axis: (typeof rubricAxes)[number]): string => {
      if (!compare || !base) return "";
      const d = r.rubric[axis] - base.rubric[axis];
      return d === 0 ? "  =" : d > 0 ? ` +${d}` : ` ${d}`;
    };
    console.log(
      [
        r.slug.padEnd(16),
        String(r.obligations).padStart(4),
        String(r.questions).padStart(3),
        String(r.flaggedPct).padStart(6),
        String(r.avgScenarioWords).padStart(6),
        String(r.avgReadingGrade).padStart(6),
        ...rubricAxes.map((a) => `${r.rubric[a]}${drift(a)}`.padStart(9)),
      ].join(" "),
    );
    if (r.distributionSkewed) {
      console.log(`  ! ${r.slug}: correct-answer distribution is skewed`);
    }
  }

  if (compare && baseline) {
    const avg = (rep: EvalReport, axis: (typeof rubricAxes)[number]) =>
      rep.results.reduce((s, r) => s + r.rubric[axis], 0) / Math.max(1, rep.results.length);
    console.log("\nDrift vs baseline (set averages):");
    for (const axis of rubricAxes) {
      const now = avg(report, axis);
      const then = avg(baseline, axis);
      const d = round(now - then, 2);
      console.log(
        `  ${axis.padEnd(26)} ${round(then, 2)} -> ${round(now, 2)} (${d >= 0 ? "+" : ""}${d})`,
      );
    }
  }
}

async function main() {
  const updateBaseline = process.argv.includes("--update-baseline");
  const golden = loadGolden();
  if (golden.length < 5) {
    console.error(`golden set has ${golden.length} policies; the minimum is 5`);
    process.exit(1);
  }

  let baseline: EvalReport | null = null;
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as EvalReport;
  } catch {
    baseline = null;
  }

  // The golden set never shrinks.
  if (baseline) {
    const currentSlugs = new Set(golden.map((g) => g.slug));
    const missing = baseline.results.filter((r) => !currentSlugs.has(r.slug));
    if (missing.length > 0) {
      console.error(
        `golden set shrank: missing ${missing.map((m) => m.slug).join(", ")} (present in baseline)`,
      );
      process.exit(1);
    }
  }

  const provider = await getProvider();
  const providerName = process.env.ANTHROPIC_API_KEY ? "anthropic" : "dev-stub";

  const results: PolicyResult[] = [];
  for (const policy of golden) {
    process.stdout.write(`evaluating ${policy.slug}... `);
    try {
      const result = await evalPolicy(provider, policy);
      results.push(result);
      console.log("done");
    } catch (err) {
      console.error(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }

  const report: EvalReport = {
    provider: providerName,
    ranAt: new Date().toISOString(),
    results,
  };
  writeFileSync(LAST_RUN_PATH, JSON.stringify(report, null, 2));
  printTable(report, baseline);

  if (updateBaseline) {
    writeFileSync(BASELINE_PATH, JSON.stringify(report, null, 2));
    console.log(`\nbaseline updated: ${BASELINE_PATH}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
