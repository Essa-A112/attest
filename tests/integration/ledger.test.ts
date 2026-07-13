// The ledger-integrity suite. This suite blocks merges and is never skipped.
import "../setup-env";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { attempts } from "@/db/schema";
import { appendAttempt, GENESIS_PREV_HASH } from "@/ledger";
import { verifyChain } from "@/ledger/verify";
import { createOrg, resetDb } from "../helpers/db";

/** Drizzle wraps PG errors; the trigger's message lives on the cause chain. */
function rootMessage(err: unknown): string {
  let current = err;
  const parts: string[] = [];
  while (current instanceof Error) {
    parts.push(current.message);
    current = current.cause;
  }
  return parts.join(" | ");
}

async function appendFor(orgId: string, score = 2, total = 3) {
  return appendAttempt({
    orgId,
    assignmentId: randomUUID(),
    courseId: randomUUID(),
    traineePseudonym: `TR-${randomUUID().slice(0, 8)}`,
    answers: [0, 1, 2],
    score,
    total,
    passed: score / total >= 0.5,
  });
}

describe("ledger integrity", () => {
  beforeEach(resetDb);

  it("chains attempts per org from a fixed genesis prev_hash", async () => {
    const orgA = await createOrg("Org A");
    const orgB = await createOrg("Org B");

    const a1 = await appendFor(orgA.id);
    const a2 = await appendFor(orgA.id);
    const b1 = await appendFor(orgB.id);

    expect(a1.prevHash).toBe(GENESIS_PREV_HASH);
    expect(a2.prevHash).toBe(a1.rowHash);
    // each org has its own genesis
    expect(b1.prevHash).toBe(GENESIS_PREV_HASH);

    expect(await verifyChain(orgA.id)).toEqual({ status: "intact", rows: 2 });
    expect(await verifyChain(orgB.id)).toEqual({ status: "intact", rows: 1 });
  });

  it("rejects UPDATE via trigger, even for the table owner", async () => {
    const org = await createOrg("Org A");
    await appendFor(org.id);
    const err = await db
      .update(attempts)
      .set({ score: 999 })
      .where(eq(attempts.orgId, org.id))
      .then(() => null)
      .catch((e: unknown) => e);
    expect(rootMessage(err)).toMatch(/append-only/);
    // and the row is untouched
    const [row] = await db.select().from(attempts).where(eq(attempts.orgId, org.id));
    expect(row?.score).not.toBe(999);
  });

  it("rejects DELETE via trigger, even for the table owner", async () => {
    const org = await createOrg("Org A");
    await appendFor(org.id);
    const err = await db
      .delete(attempts)
      .where(eq(attempts.orgId, org.id))
      .then(() => null)
      .catch((e: unknown) => e);
    expect(rootMessage(err)).toMatch(/append-only/);
    expect(await db.select().from(attempts).where(eq(attempts.orgId, org.id))).toHaveLength(1);
  });

  it("tampering with row contents breaks verification", async () => {
    const org = await createOrg("Org A");
    await appendFor(org.id, 1, 3);
    await appendFor(org.id, 2, 3);

    // Bypass the trigger the only way possible (superuser replica mode) to
    // simulate an attacker with raw DB access flipping a failed run to passed.
    await db.execute(sql`set session_replication_role = replica`);
    try {
      await db.execute(
        sql`update attempts set score = 3, passed = true where org_id = ${org.id} and score = 1`,
      );
    } finally {
      await db.execute(sql`set session_replication_role = default`);
    }

    const result = await verifyChain(org.id);
    expect(result.status).toBe("broken");
    if (result.status === "broken") {
      expect(result.reason).toMatch(/tampered/);
    }
  });

  it("splicing the chain (rewriting hashes) breaks verification at the link", async () => {
    const org = await createOrg("Org A");
    await appendFor(org.id);
    await appendFor(org.id);

    await db.execute(sql`set session_replication_role = replica`);
    try {
      // rewrite the first row's hash consistently; the second row's prev_hash
      // no longer matches, so the splice is detected at the link
      await db.execute(
        sql`update attempts set row_hash = repeat('ab', 32) where org_id = ${org.id} and prev_hash = ${GENESIS_PREV_HASH}`,
      );
    } finally {
      await db.execute(sql`set session_replication_role = default`);
    }

    const result = await verifyChain(org.id);
    expect(result.status).toBe("broken");
  });

  it("app role has INSERT and SELECT only on attempts", async () => {
    const org = await createOrg("Org A");
    await appendFor(org.id);

    const url = new URL(process.env.DATABASE_URL ?? "");
    const appSql = postgres(
      `postgres://attest_app:attest_app@${url.hostname}:${url.port || 5432}${url.pathname}`,
      { max: 1 },
    );
    try {
      // SELECT allowed
      const rows = await appSql`select count(*)::int as n from attempts`;
      expect(rows[0]?.n).toBe(1);

      // INSERT allowed (grants-level check; chain hashing is the app's job)
      await appSql`
        insert into attempts (org_id, assignment_id, course_id, trainee_pseudonym,
                              answers, score, total, passed, created_at, prev_hash, row_hash)
        values (${org.id}, ${randomUUID()}, ${randomUUID()}, 'TR-granttest',
                '[0]'::jsonb, 1, 1, true, now(), repeat('0', 64), repeat('f', 64))
      `;

      // UPDATE and DELETE denied by grants (permission, before the trigger)
      await expect(appSql`update attempts set score = 0`).rejects.toThrow(
        /permission denied/,
      );
      await expect(appSql`delete from attempts`).rejects.toThrow(/permission denied/);
      // and the app role cannot truncate the ledger either
      await expect(appSql`truncate attempts`).rejects.toThrow(/permission denied/);
    } finally {
      await appSql.end();
    }
  });
});

afterAll(async () => {
  await resetDb();
});
