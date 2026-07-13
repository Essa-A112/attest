import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.APP_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://attest:attest@localhost:5432/attest";

// Single connection pool per process. Next.js dev hot-reload re-evaluates modules,
// so stash the client on globalThis to avoid exhausting Postgres connections.
const globalForDb = globalThis as unknown as { pgClient?: ReturnType<typeof postgres> };

export const pgClient = globalForDb.pgClient ?? postgres(connectionString, { max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb.pgClient = pgClient;

export const db = drizzle(pgClient, { schema });
