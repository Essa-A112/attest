import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assignments, courses } from "@/db/schema";
import { canPublish, reviewSummary } from "@/courses/review";
import { getCourseForOrg } from "@/courses/queries";
import { sendEmail } from "@/emails/mailer";
import { logEvent } from "@/events";
import { upsertTrainees } from "@/trainees";

export class PublishError extends Error {}

export interface PublishInput {
  passMark: number;
  dueAt: Date | null;
  emails: string[];
}

function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}

/**
 * Publishes a course: review gate re-checked server-side, trainees upserted by
 * email (pseudonyms reused), one assignment + magic link per trainee, emails
 * sent. The gate check here is the enforcement, not the UI.
 */
export async function publishCourse(
  orgId: string,
  actor: string,
  courseId: string,
  input: PublishInput,
): Promise<{ assignmentCount: number }> {
  const row = await getCourseForOrg(orgId, courseId);
  if (!row) throw new PublishError("course not found");
  if (row.course.status !== "draft") throw new PublishError("course is not a draft");

  const summary = await reviewSummary(courseId);
  if (!canPublish(summary)) {
    throw new PublishError(
      summary.pending > 0
        ? `cannot publish: ${summary.pending} question(s) still pending review`
        : "cannot publish: the course needs at least one approved question",
    );
  }

  if (!Number.isInteger(input.passMark) || input.passMark < 1 || input.passMark > 100) {
    throw new PublishError("pass mark must be between 1 and 100");
  }
  const traineeRows = await upsertTrainees(orgId, input.emails);
  if (traineeRows.length === 0) {
    throw new PublishError("at least one valid trainee email is required");
  }

  await db
    .update(courses)
    .set({ status: "published", passMark: input.passMark })
    .where(eq(courses.id, courseId));

  let assignmentCount = 0;
  for (const trainee of traineeRows) {
    const token = randomBytes(24).toString("hex");
    await db.insert(assignments).values({
      courseId,
      traineePseudonym: trainee.pseudonym,
      token,
      dueAt: input.dueAt,
    });
    assignmentCount++;

    const link = `${appUrl()}/t/${token}`;
    await sendEmail({
      to: trainee.email,
      subject: `Training to complete: ${row.policy.title}`,
      text: `You have been assigned training on "${row.policy.title}".\n\nStart here: ${link}\n\n${
        input.dueAt ? `Please complete it by ${input.dueAt.toDateString()}.` : ""
      }\nIt takes under ten minutes, no account needed.`,
      html: `<p>You have been assigned training on <strong>${row.policy.title}</strong>.</p><p><a href="${link}">Start the training</a>${
        input.dueAt ? ` — please complete it by ${input.dueAt.toDateString()}.` : ""
      }</p><p>It takes under ten minutes, no account needed.</p>`,
    });
  }

  await logEvent({
    orgId,
    actor,
    action: "course.published",
    subject: `course:${courseId}`,
  });

  return { assignmentCount };
}
