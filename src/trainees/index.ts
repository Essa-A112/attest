import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { trainees } from "@/db/schema";

/**
 * Trainee identity handling. PII (name, email) lives in the trainees table and
 * nowhere else; every other table references the pseudonym.
 */

function newPseudonym(): string {
  return `TR-${randomBytes(8).toString("hex")}`;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Upserts trainees by (org, email); existing trainees keep their pseudonym so
 * re-assignments and re-attestations accrue to the same chain identity. */
export async function upsertTrainees(
  orgId: string,
  emails: string[],
): Promise<{ pseudonym: string; email: string }[]> {
  const unique = [...new Set(emails.map(normalizeEmail).filter((e) => e.includes("@")))];
  if (unique.length === 0) return [];

  const existing = await db
    .select()
    .from(trainees)
    .where(and(eq(trainees.orgId, orgId), inArray(trainees.email, unique)));
  const byEmail = new Map(existing.map((t) => [t.email, t]));

  const out: { pseudonym: string; email: string }[] = [];
  for (const email of unique) {
    const found = byEmail.get(email);
    if (found) {
      out.push({ pseudonym: found.pseudonym, email });
      continue;
    }
    const [created] = await db
      .insert(trainees)
      .values({ orgId, email, pseudonym: newPseudonym() })
      .returning();
    if (!created) throw new Error("trainee insert failed");
    out.push({ pseudonym: created.pseudonym, email });
  }
  return out;
}

/**
 * GDPR erasure: deletes the pseudonym→PII mapping row. Assignments and ledger
 * rows survive untouched; the record becomes "a trainee" rather than a person.
 */
export async function eraseTrainee(orgId: string, traineeId: string): Promise<boolean> {
  const deleted = await db
    .delete(trainees)
    .where(and(eq(trainees.id, traineeId), eq(trainees.orgId, orgId)))
    .returning({ id: trainees.id });
  return deleted.length > 0;
}

export async function listTrainees(orgId: string) {
  return db.select().from(trainees).where(eq(trainees.orgId, orgId)).orderBy(trainees.email);
}

/** Resolves a pseudonym to an email for notification purposes only. Returns
 * null after erasure. */
export async function emailForPseudonym(orgId: string, pseudonym: string) {
  const row = await db.query.trainees.findFirst({
    where: and(eq(trainees.orgId, orgId), eq(trainees.pseudonym, pseudonym)),
  });
  return row?.email ?? null;
}
