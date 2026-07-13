import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const GOLDEN_DIR = path.join(process.cwd(), "eval", "golden");
const BASELINE_PATH = path.join(process.cwd(), "eval", "baseline.json");

describe("golden set", () => {
  it("has at least five policies", () => {
    const files = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  it("never shrinks: every baseline policy still exists", () => {
    if (!existsSync(BASELINE_PATH)) return; // no baseline yet
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as {
      results: { slug: string }[];
    };
    const current = new Set(
      readdirSync(GOLDEN_DIR)
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(/\.md$/, "")),
    );
    for (const r of baseline.results) {
      expect(current.has(r.slug), `golden policy "${r.slug}" was removed`).toBe(true);
    }
  });

  it("policies are non-trivial documents with obligations", () => {
    for (const file of readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".md"))) {
      const text = readFileSync(path.join(GOLDEN_DIR, file), "utf8");
      expect(text.length).toBeGreaterThan(400);
      expect(text).toMatch(/must/i);
    }
  });
});
