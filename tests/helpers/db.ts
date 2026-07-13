import "../setup-env";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { orgs, users } from "@/db/schema";

/** Truncates all mutable app tables. Never used against ledger tables once they
 * exist in production — this helper is test-only. */
export async function resetDb(): Promise<void> {
  await db.execute(sql`
    truncate table
      attempts,
      assignments,
      trainees,
      events,
      generation_runs,
      questions,
      obligations,
      courses,
      policies,
      verification_tokens,
      sessions,
      accounts,
      users,
      orgs
    restart identity cascade
  `);
}

export async function createOrg(name: string) {
  const [org] = await db.insert(orgs).values({ name }).returning();
  if (!org) throw new Error("insert org failed");
  return org;
}

export async function createUser(
  orgId: string,
  email: string,
  role: "admin" | "viewer" = "admin",
) {
  const [user] = await db.insert(users).values({ orgId, email, role }).returning();
  if (!user) throw new Error("insert user failed");
  return user;
}
