import { db } from "@/db";
import { events } from "@/db/schema";

/**
 * Audit log write. Only identifiers go in — never policy text, question
 * content, or trainee PII (hard rule 6).
 */
export async function logEvent(params: {
  orgId: string;
  actor: string;
  action: string;
  subject: string;
}): Promise<void> {
  await db.insert(events).values(params);
}
