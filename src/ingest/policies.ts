import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { policies } from "@/db/schema";
import { getStorage } from "@/storage";
import { detectKind, extractDocument, normalizeText, type SourceKind } from "./extract";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export interface NewPolicyInput {
  orgId: string;
  title: string;
  text: string;
  sourceKind: SourceKind;
  sourceFileKey?: string;
}

/**
 * Stores a policy as a new version. A changed policy is always a new row with
 * version = latest + 1 for (org, title); rows are never edited. The unique
 * index on (org_id, title, version) plus a retry makes concurrent uploads safe.
 */
export async function createPolicyVersion(input: NewPolicyInput) {
  const text = normalizeText(input.text);
  if (text.length === 0) throw new Error("policy text is empty after extraction");
  const hash = sha256Hex(text);

  for (let attempt = 0; attempt < 3; attempt++) {
    const [latest] = await db
      .select({ max: sql<number | null>`max(${policies.version})` })
      .from(policies)
      .where(and(eq(policies.orgId, input.orgId), eq(policies.title, input.title)));
    const version = (latest?.max ?? 0) + 1;

    try {
      const [row] = await db
        .insert(policies)
        .values({
          orgId: input.orgId,
          title: input.title,
          version,
          text,
          sha256: hash,
          sourceKind: input.sourceKind,
          sourceFileKey: input.sourceFileKey,
        })
        .returning();
      if (!row) throw new Error("policy insert returned no row");
      return row;
    } catch (err) {
      const isUniqueViolation =
        err instanceof Error && "code" in err && (err as { code?: string }).code === "23505";
      if (!isUniqueViolation || attempt === 2) throw err;
    }
  }
  throw new Error("unreachable");
}

/**
 * Ingests an uploaded file: stores the original bytes, extracts text
 * server-side, and records a new policy version.
 */
export async function ingestPolicyFile(params: {
  orgId: string;
  title: string;
  filename: string;
  contentType: string | null;
  bytes: Uint8Array;
}) {
  const kind = detectKind(params.filename, params.contentType);
  const { text } = await extractDocument(params.bytes, kind);

  const key = `${params.orgId}/policies/${randomUUID()}-${params.filename.replaceAll(/[^a-zA-Z0-9._-]/g, "_")}`;
  await getStorage().put(key, params.bytes, params.contentType ?? "application/octet-stream");

  return createPolicyVersion({
    orgId: params.orgId,
    title: params.title,
    text,
    sourceKind: kind,
    sourceFileKey: key,
  });
}

export async function listPolicies(orgId: string) {
  return db
    .select()
    .from(policies)
    .where(eq(policies.orgId, orgId))
    .orderBy(policies.title, desc(policies.version));
}

export async function getPolicy(orgId: string, policyId: string) {
  return db.query.policies.findFirst({
    where: and(eq(policies.id, policyId), eq(policies.orgId, orgId)),
  });
}
