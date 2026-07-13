# Attest: product requirements

## One line

Attest turns any written company policy into scenario-based training with an audit-grade completion ledger, in minutes instead of weeks.

## Problem

Companies are obliged to train staff on their own policies: data handling, health and safety, expenses, safeguarding, AML, IT security. What they actually buy is generic per-seat e-learning that never mentions their policies, and what they actually hold as evidence is a signature on a form nobody read. Bespoke course production from agencies costs thousands per module and takes weeks. When an auditor, insurer, regulator or employment tribunal asks whether staff read and understood a specific policy, most firms have nothing that stands up.

The product wedge is comprehension evidence on the customer's own documents. Generation speed is how it gets delivered cheaply; the ledger is what the buyer is actually paying for.

## Who buys it, who uses it

The buyer is an HR manager, ops lead or compliance officer at a firm of roughly 20 to 500 employees, concentrated in regulated-adjacent sectors: recruitment, care providers, letting and estate agents, financial services suppliers, charities. The admin is usually the same person. Trainees are every employee, on a phone, in under ten minutes, with no account to create. A secondary buyer appears in phase 2: fractional HR consultants and outsourced compliance firms managing many client orgs.

Jobs the product is hired for: publish training on a specific internal policy fast; hold evidence of comprehension for audits, insurance renewals and disputes; track completion and chase stragglers; re-attest annually and whenever a policy changes.

## MVP scope

1. Org sign-up and admin accounts, email magic-link auth throughout. No passwords anywhere in the product.
2. Policy intake: paste text, or upload PDF or docx. Text extracted server-side, stored with a SHA-256 hash and a version number. A changed policy is a new version, never an edit.
3. Generation: the pipeline extracts obligations with verbatim quotes and character offsets, then writes 8 to 12 scenario questions, each tied to one obligation and citing the exact clause.
4. Review gate: nothing publishes until an admin has approved, edited or deleted every question. This is a hard product rule. It protects quality, and it means a human signed off the content, which matters if the evidence is ever challenged.
5. Publishing: pass mark, due date, trainee list by email. Each trainee gets a magic link.
6. Trainee flow: a short brief of the obligations, scenarios one at a time, instant marking with the clause quoted back, score, pass or retake.
7. Ledger: every attempt appended to a hash-chained, append-only record. See the architecture doc for the erasure design.
8. Evidence pack export: a PDF per course version containing the policy hash, the approved question set, per-trainee outcomes and a chain verification result, plus CSV.
9. Reminder emails at assignment, seven days, one day, and overdue.
10. Re-attestation by manual re-publish. Scheduling comes later.

Deliberately not in the MVP: SSO, HRIS integrations, SCORM export, a policy template library, multi-language, mobile apps.

## Phase 2

Annual re-attestation scheduling. Policy change detection that generates delta training on what changed. Slack and Teams nudges. Manager dashboards. A starter library of editable policy templates so new firms have something to train on day one. Multi-org accounts for consultants.

## Phase 3

SSO with Google and Microsoft. HRIS sync (BreatheHR, Personio, BambooHR) so trainee lists maintain themselves. SCORM and xAPI export for firms with an existing LMS. A public API.

## Why it wins

Incumbents (iHASCO under Citation Group, Skillcast, EssentialSkillz, DeltaNet) sell libraries of generic courses at roughly £5 to £30 per seat per course. None of them train the customer's own documents, because authoring is their cost centre. Attest inverts that: authoring is near-free, so the product can be about the customer's actual policies and the evidence trail. The DIY alternative, Google Forms plus a PDF, produces no comprehension test worth the name and no tamper-evident record.

## Pricing

Launch with flat tiers: Starter at £29 a month up to 25 staff, Growth at £79 up to 100, Scale at £199 up to 500, unlimited policies and courses at every tier, annual discount of two months. Revisit per-employee pricing (£1 to £2 per employee per month) once HRIS sync exists and headcount is verifiable. The comparison the buyer makes is one agency-built module at £2,000 or one incumbent renewal, so the ceiling is higher than these numbers; start low, learn, raise.

## Success metrics

Activation is a first published course within 24 hours of sign-up, with time-to-first-course under 15 minutes. Trainee completion above 85 per cent within 14 days of assignment. Question rejection rate in the review gate below 25 per cent, as the standing quality proxy. Logo retention at renewal, and monthly recurring revenue.

## Risks and open questions

Question quality is the existential risk: a generated question that misstates the policy poisons trust and the evidence. Mitigations are the review gate, per-question clause citations, a checker pass, and an eval suite that gates prompt changes.

Legal weight of the evidence is unproven. Copy discipline from day one: Attest supports an audit trail, it does not guarantee compliance and it is not legal advice. Get the evidence pack format in front of an employment solicitor before charging for it.

Employee names and scores are personal data. The product acts as processor for its customers: DPA, published subprocessor list (model provider, host, email provider), UK or EU data residency, and an erasure mechanism that survives contact with an immutable ledger (solved in the architecture doc by splitting PII from the chain).

Uploaded policies are untrusted input to the model. Generation treats document text strictly as data, runs no tools, and validates output against a schema.

The name clashes with attest.com, an established consumer research platform. Rename before anything public, and check UK trade marks. Working candidates should keep the meaning: attestation, comprehension, proof.

Single-provider dependency on the model API. Keep the provider behind one interface and keep the eval suite provider-agnostic so switching is a config change plus an eval run.
