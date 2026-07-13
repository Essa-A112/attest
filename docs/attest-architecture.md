# Attest: technical architecture

## What carries over from the artifact, and what does not

The artifact proved the loop: policy in, scenario questions out, instant marking, shared completion record. What carries over is the two-pass generation shape, the pass-mark logic, the trainee flow, and the stamp moment. What does not carry over: window.storage (replaced by Postgres), the in-page model calls (a Claude.ai artifact feature; in production all model calls are server-side and no key ever reaches a client), and the absence of auth, tenancy, and versioning.

## Stack

Next.js (App Router) with TypeScript in strict mode, deployed on Vercel, or a single Node service on Render if server control matters more than edge. Postgres on Neon or Supabase, Drizzle ORM, migrations checked in. Auth.js with email magic links, sent through Resend. Background jobs (generation, reminders) through Inngest or pg-boss; generation must never run inside a request handler. File storage on Cloudflare R2. Text extraction server-side with unpdf for PDF and mammoth for docx. Sentry for errors, PostHog for product analytics. Boring choices on purpose: one person has to run this.

Model calls go through the Anthropic API behind a single provider interface in `src/llm/`. Use the current mid-tier model for extraction and generation and the current small model for the checker pass; verify current model names, structured output support and rate limits against https://docs.claude.com/en/api/overview before the first line of pipeline code, and pin model versions in config, never inline.

## Data model

```
orgs(id, name, created_at, retention_days)
users(id, org_id, email, role admin|viewer)
policies(id, org_id, title, version, text, source_file_url, sha256, created_at)
courses(id, policy_id, version, status draft|published|retired, pass_mark, created_by)
questions(id, course_id, obligation_id, scenario, options jsonb, correct int,
          rationale, source_quote, source_offsets, review_status pending|approved|edited|rejected)
trainees(id, org_id, pseudonym, name, email)          -- mutable, PII lives ONLY here
assignments(id, course_id, trainee_pseudonym, due_at, completed_at)
attempts(id, assignment_id, course_id, trainee_pseudonym, answers jsonb,
         score, total, passed, created_at, prev_hash, row_hash)   -- append-only
events(id, org_id, actor, action, subject, created_at)            -- audit log
```

## The ledger

`attempts` is the product. Append-only is enforced three ways: the application role has INSERT and SELECT only, a trigger rejects UPDATE and DELETE, and a test suite asserts both. Each row's `row_hash` is SHA-256 over `prev_hash` plus a canonical serialisation of the row; each org has a genesis row. A verification function walks the chain and is exposed in the admin UI and in the evidence pack.

Erasure and immutability coexist by splitting identity from record. Ledger rows carry only a pseudonym. The `trainees` table maps pseudonym to name and email and is mutable. A GDPR erasure request deletes the mapping row; the chain stays intact and verifiable, and the record becomes "a trainee" rather than a person. The evidence pack explains this design in one paragraph so auditors are not surprised.

## The generation pipeline

Three passes, all server-side, all logged for evals.

Pass A, extraction. Input is the policy text delimited strictly as data. Output is JSON: obligations, each with an id, a plain statement, a verbatim quote and character offsets. Programmatic check: the quote must appear at the claimed offsets, or the obligation is dropped.

Pass B, generation. Per batch of obligations, output is JSON questions: obligation_id, a second-person scenario under 40 words, four options, the correct index, a rationale citing the clause. Prompt requirements: wrong options are plausible violations, correct indices roughly uniform, no generic ethics questions.

Pass C, validation. Programmatic first: schema, option uniqueness, index distribution, quote-in-policy check, reading level cap. Then a cheap checker call grades each question on two axes: does the keyed answer follow from the quoted clause alone, and are the distractors defensible violations rather than nonsense. Failures are not discarded; they land in the review queue flagged, because the admin review gate is the final validator.

Repair loop of at most two retries per pass. Everything (inputs, outputs, latencies, model versions) is written to a `generation_runs` table.

Prompt injection: uploaded documents are untrusted. The generation calls run no tools, the document is fenced as data, and nothing from the document is ever executed or fetched.

## Tenancy and security

Every query is scoped by org_id; if on Supabase, RLS as a second layer. A cross-tenant test suite creates two orgs and asserts zero leakage on every endpoint, and it blocks merges. Rate limiting on auth and upload endpoints. Secrets in the platform vault, never in the repo. Policy text and trainee PII never appear in logs.

## Evals

A golden set of 20 policies (write five synthetic ones to start, add real anonymised ones as customers allow) with human ratings on four axes: accuracy to the policy, distractor plausibility, scenario realism, single defensible answer. `pnpm eval` runs the full pipeline against the set and reports drift. No prompt or model change merges without the eval delta attached to the PR.

## Cost

A course version costs three to six model calls, which is pennies against any pricing tier. Ignore model cost until it appears in the accounts; do not engineer around it early.

## Environments

Local with Docker Postgres, a staging deployment with a seeded demo org, production. Migrations run forward-only in production; ledger tables are excluded from any data-fixing migration by convention and by the trigger.
