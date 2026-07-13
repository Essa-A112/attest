import { eq, isNotNull, and } from "drizzle-orm";
import { db } from "@/db";
import { assignments } from "@/db/schema";

export async function getAssignmentProgress(courseId: string) {
  const all = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(eq(assignments.courseId, courseId));
  const done = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(and(eq(assignments.courseId, courseId), isNotNull(assignments.completedAt)));
  return { total: all.length, completed: done.length };
}
