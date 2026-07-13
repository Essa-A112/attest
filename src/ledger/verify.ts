import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { attempts } from "@/db/schema";
import { computeRowHash, GENESIS_PREV_HASH } from "./index";

export type ChainVerification =
  | { status: "intact"; rows: number }
  | { status: "broken"; rows: number; atSeq: number; reason: string };

/**
 * Walks an org's attempt chain in append order and returns the first broken
 * link or "intact". Detects both content tampering (recomputed row hash
 * mismatch) and chain splicing (prev_hash not matching the previous row).
 * Exposed in the admin UI and in the evidence pack.
 */
export async function verifyChain(orgId: string): Promise<ChainVerification> {
  const rows = await db
    .select()
    .from(attempts)
    .where(eq(attempts.orgId, orgId))
    .orderBy(asc(attempts.seq));

  let prev = GENESIS_PREV_HASH;
  for (const row of rows) {
    if (row.prevHash !== prev) {
      return {
        status: "broken",
        rows: rows.length,
        atSeq: row.seq,
        reason: `prev_hash does not match the previous row's hash (expected ${prev.slice(0, 12)}…, found ${row.prevHash.slice(0, 12)}…)`,
      };
    }
    const recomputed = computeRowHash(row.prevHash, {
      orgId: row.orgId,
      assignmentId: row.assignmentId,
      courseId: row.courseId,
      traineePseudonym: row.traineePseudonym,
      answers: row.answers,
      score: row.score,
      total: row.total,
      passed: row.passed,
      createdAt: row.createdAt.toISOString(),
    });
    if (recomputed !== row.rowHash) {
      return {
        status: "broken",
        rows: rows.length,
        atSeq: row.seq,
        reason: "row contents do not match row_hash (row was tampered with)",
      };
    }
    prev = row.rowHash;
  }
  return { status: "intact", rows: rows.length };
}
