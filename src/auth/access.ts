import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

/**
 * Magic links are only issued to users that already exist and belong to an org.
 * Anyone else is rejected before an email is ever sent, so sign-in cannot be
 * used to enumerate or create accounts.
 */
export async function isSignInAllowed(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const existing = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
  });
  return Boolean(existing?.orgId);
}
