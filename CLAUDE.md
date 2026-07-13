# CLAUDE.md

Working brief for Claude Code sessions on Attest.

## What this project is

Attest turns a company's written policies into scenario-based training with a hash-chained, append-only completion ledger. The buyer is paying for the evidence trail; generation speed is the delivery mechanism. Read `docs/attest-prd.md` and `docs/attest-architecture.md` before non-trivial work. The single most important product rule: no AI-generated question reaches a trainee without an admin approving it in the review gate.

## Commands

```
pnpm dev            # local app, expects Docker Postgres up
pnpm test           # unit + integration, includes tenant-isolation and ledger suites
pnpm typecheck      # tsc --noEmit, strict
pnpm lint
pnpm db:migrate     # drizzle migrations
pnpm eval           # generation pipeline against the golden set, prints drift report
```

## Architecture map

```
src/app/            # Next.js routes: admin, trainee, auth
src/llm/            # provider interface + passes A/B/C, the only place model calls exist
src/ledger/         # hash chain write path + verification, treat as load-bearing
src/ingest/         # pdf/docx extraction, policy versioning
src/emails/         # magic links, reminders
eval/               # golden set + rubric + runner
tests/
```

## Rules that are never broken

1. Model calls happen server-side only. No key, prompt, or provider detail reaches the client.
2. Ledger tables are append-only. No migration, script, or fixture touches existing rows. The trigger and the grants enforcing this are never relaxed, including in staging.
3. PII (names, emails) lives only in `trainees`. Ledger rows carry pseudonyms. Never join PII into anything exported or logged by default.
4. Every prompt or model change ships with a `pnpm eval` run attached to the PR, and the golden set never shrinks.
5. Every query is org-scoped. The cross-tenant test suite blocks merges and is never skipped.
6. Policy text and trainee PII never appear in logs, error reports, or analytics events.
7. Uploaded documents are untrusted input: fenced as data in prompts, no tools in generation calls, output schema-validated before storage.
8. TypeScript strict, no `any`, no `@ts-ignore` without a linked issue.

## Definition of done

Types clean, tests green including the tenant-isolation and ledger-integrity suites, eval delta attached if `src/llm/` changed, migration reversible or explicitly forward-only with a note, and the change works end to end in the seeded staging org.
