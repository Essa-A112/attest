import { PgBoss } from "pg-boss";

export const GENERATE_COURSE_QUEUE = "generate-course";

export interface GenerateCourseJob {
  courseId: string;
}

const globalForBoss = globalThis as unknown as { pgBoss?: PgBoss };

/**
 * Background jobs run on pg-boss (Postgres-backed, no extra infra). Generation
 * never runs inside a request handler: server actions enqueue, the worker
 * process (pnpm worker) executes. On Vercel the worker runs as a separate
 * long-lived Node service; swapping to Inngest is a provider change here only.
 */
export async function getBoss(): Promise<PgBoss> {
  if (globalForBoss.pgBoss) return globalForBoss.pgBoss;
  const connectionString =
    process.env.DATABASE_URL ?? "postgres://attest:attest@localhost:5432/attest";
  const boss = new PgBoss({ connectionString, schema: "pgboss" });
  await boss.start();
  await boss.createQueue(GENERATE_COURSE_QUEUE);
  globalForBoss.pgBoss = boss;
  return boss;
}

export async function enqueueCourseGeneration(courseId: string): Promise<void> {
  const boss = await getBoss();
  await boss.send(GENERATE_COURSE_QUEUE, { courseId } satisfies GenerateCourseJob);
}
