// Background worker: executes generation jobs queued by the app.
// Usage: pnpm worker
import "dotenv/config";
import type { Job } from "pg-boss";
import { GENERATE_COURSE_QUEUE, getBoss, type GenerateCourseJob } from "../src/jobs";
import { runCourseGeneration } from "../src/jobs/generate-course";

async function main() {
  const boss = await getBoss();

  await boss.work<GenerateCourseJob>(GENERATE_COURSE_QUEUE, async (jobs: Job<GenerateCourseJob>[]) => {
    for (const job of jobs) {
      console.log(`[worker] generating course ${job.data.courseId}`);
      await runCourseGeneration(job.data.courseId);
      console.log(`[worker] finished course ${job.data.courseId}`);
    }
  });

  console.log("[worker] listening for jobs");

  const shutdown = async () => {
    await boss.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
