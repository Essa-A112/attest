/**
 * Model versions are pinned here and only here — never inline in pipeline code.
 * Current IDs verified against Anthropic docs (claude-api reference, June 2026):
 * mid-tier = Claude Sonnet 5, small = Claude Haiku 4.5. Aliases are complete
 * as-is; do not append date suffixes.
 */
export const llmConfig = {
  extractionModel: process.env.ATTEST_EXTRACTION_MODEL ?? "claude-sonnet-5",
  generationModel: process.env.ATTEST_GENERATION_MODEL ?? "claude-sonnet-5",
  checkerModel: process.env.ATTEST_CHECKER_MODEL ?? "claude-haiku-4-5",
  maxOutputTokens: 8192,
  /** Repair loop budget: at most two retries per pass. */
  maxRetriesPerPass: 2,
} as const;
