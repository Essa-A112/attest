# Attest

Attest turns a company's written policies into scenario-based training with a
hash-chained, append-only completion ledger. See `docs/attest-prd.md` and
`docs/attest-architecture.md` for the product and technical briefs, and
`CLAUDE.md` for the working rules.

## Local development

Requirements: Node 22+, pnpm 10+, Docker.

```sh
cp .env.example .env
docker compose up -d          # Postgres 16 on localhost:5432
pnpm install
pnpm db:migrate
pnpm seed                     # demo org + admin@demo.attest.local
pnpm dev                      # app on localhost:3000
pnpm worker                   # in a second terminal: runs generation jobs
```

Without `RESEND_API_KEY`, magic-link emails are written to `.dev-mail/` as
JSON files — open the latest file and follow the link. Without
`ANTHROPIC_API_KEY`, generation uses a deterministic dev stub so the whole
flow (generate → review → publish → trainee → evidence pack) works offline;
production requires the real key and refuses to fall back.

## Commands

```
pnpm dev            # local app, expects Docker Postgres up
pnpm test           # unit + integration, includes tenant-isolation and ledger suites
pnpm typecheck      # tsc --noEmit, strict
pnpm lint
pnpm db:generate    # generate a migration from schema changes
pnpm db:migrate     # apply drizzle migrations
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
