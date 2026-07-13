// Seeds the demo org with one admin. Idempotent: safe to run repeatedly.
// Usage: pnpm seed
import "dotenv/config";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";

const DEMO_ORG_NAME = "Demo Org";
const DEMO_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@demo.attest.local";

async function main() {
  const url = process.env.DATABASE_URL ?? "postgres://attest:attest@localhost:5432/attest";
  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });

  let org = await db.query.orgs.findFirst({
    where: eq(schema.orgs.name, DEMO_ORG_NAME),
  });
  if (!org) {
    [org] = await db.insert(schema.orgs).values({ name: DEMO_ORG_NAME }).returning();
  }
  if (!org) throw new Error("failed to create demo org");

  const admin = await db.query.users.findFirst({
    where: eq(schema.users.email, DEMO_ADMIN_EMAIL),
  });
  if (!admin) {
    await db.insert(schema.users).values({
      orgId: org.id,
      email: DEMO_ADMIN_EMAIL,
      role: "admin",
      name: "Demo Admin",
    });
  }

  console.log(`Seeded org "${DEMO_ORG_NAME}" with admin ${DEMO_ADMIN_EMAIL}`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
