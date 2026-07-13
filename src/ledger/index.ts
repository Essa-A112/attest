import { createHash } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { attempts } from "@/db/schema";

/**
 * The attempts ledger write path. Load-bearing: this is the evidence the
 * customer pays for. Every attempt row is hash-chained per org:
 *   row_hash = SHA-256(prev_hash + canonical(business fields))
 * The first row of each org chains from a fixed genesis prev_hash. Rows are
 * never updated or deleted (enforced by trigger + grants in the ledger
 * migration); erasure of trainee PII happens in `trainees`, never here.
 */

export const GENESIS_PREV_HASH = "0".repeat(64);

export interface AttemptBusinessFields {
  orgId: string;
  assignmentId: string;
  courseId: string;
  traineePseudonym: string;
  answers: number[];
  score: number;
  total: number;
  passed: boolean;
  /** ISO-8601 UTC, captured at write time and stored verbatim. */
  createdAt: string;
}

/**
 * Canonical serialisation: keys sorted, integers rendered without decoration,
 * arrays kept in order. Any change to this format breaks verification of
 * existing chains, so it never changes.
 */
export function canonicalSerialize(fields: AttemptBusinessFields): string {
  const entries: [string, string][] = [
    ["answers", `[${fields.answers.map((n) => String(n)).join(",")}]`],
    ["assignmentId", fields.assignmentId],
    ["courseId", fields.courseId],
    ["createdAt", fields.createdAt],
    ["orgId", fields.orgId],
    ["passed", fields.passed ? "true" : "false"],
    ["score", String(fields.score)],
    ["total", String(fields.total)],
    ["traineePseudonym", fields.traineePseudonym],
  ];
  return entries.map(([k, v]) => `${k}=${v}`).join("|");
}

export function computeRowHash(prevHash: string, fields: AttemptBusinessFields): string {
  return createHash("sha256")
    .update(prevHash + canonicalSerialize(fields), "utf8")
    .digest("hex");
}

/**
 * Appends an attempt to the org's chain. The advisory lock serialises writers
 * per org so two concurrent attempts cannot both chain off the same head.
 */
export async function appendAttempt(
  fields: Omit<AttemptBusinessFields, "createdAt">,
): Promise<{ id: string; rowHash: string; prevHash: string; createdAt: Date }> {
  const createdAt = new Date();
  const business: AttemptBusinessFields = {
    ...fields,
    createdAt: createdAt.toISOString(),
  };

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${fields.orgId}))`);

    const [head] = await tx
      .select({ rowHash: attempts.rowHash })
      .from(attempts)
      .where(eq(attempts.orgId, fields.orgId))
      .orderBy(desc(attempts.seq))
      .limit(1);
    const prevHash = head?.rowHash ?? GENESIS_PREV_HASH;
    const rowHash = computeRowHash(prevHash, business);

    const [row] = await tx
      .insert(attempts)
      .values({
        orgId: fields.orgId,
        assignmentId: fields.assignmentId,
        courseId: fields.courseId,
        traineePseudonym: fields.traineePseudonym,
        answers: fields.answers,
        score: fields.score,
        total: fields.total,
        passed: fields.passed,
        createdAt,
        prevHash,
        rowHash,
      })
      .returning({ id: attempts.id });
    if (!row) throw new Error("attempt insert failed");
    return { id: row.id, rowHash, prevHash, createdAt };
  });
}
