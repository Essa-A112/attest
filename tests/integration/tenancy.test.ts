// Cross-tenant isolation suite. Every issue that adds an org-scoped resource
// must extend this file: two orgs, assert zero leakage on every access path.
import "../setup-env";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createOrg, createUser, resetDb } from "../helpers/db";

describe("tenant isolation", () => {
  beforeEach(resetDb);

  it("org-scoped user queries never return the other org's users", async () => {
    const orgA = await createOrg("Org A");
    const orgB = await createOrg("Org B");
    await createUser(orgA.id, "a@org-a.test");
    await createUser(orgB.id, "b@org-b.test");

    const seenFromA = await db.query.users.findMany({
      where: eq(users.orgId, orgA.id),
    });
    expect(seenFromA).toHaveLength(1);
    expect(seenFromA[0]?.email).toBe("a@org-a.test");

    const crossLookup = await db.query.users.findFirst({
      where: and(eq(users.orgId, orgA.id), eq(users.email, "b@org-b.test")),
    });
    expect(crossLookup).toBeUndefined();
  });
});
