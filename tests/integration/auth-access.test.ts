import "../setup-env";
import { beforeEach, describe, expect, it } from "vitest";
import { isSignInAllowed } from "@/auth/access";
import { createOrg, createUser, resetDb } from "../helpers/db";

describe("magic-link sign-in gate", () => {
  beforeEach(resetDb);

  it("allows an existing org member", async () => {
    const org = await createOrg("Org A");
    await createUser(org.id, "admin@org-a.test");
    await expect(isSignInAllowed("admin@org-a.test")).resolves.toBe(true);
  });

  it("is case-insensitive on email", async () => {
    const org = await createOrg("Org A");
    await createUser(org.id, "admin@org-a.test");
    await expect(isSignInAllowed("Admin@Org-A.test")).resolves.toBe(true);
  });

  it("rejects unknown emails without creating anything", async () => {
    await expect(isSignInAllowed("stranger@nowhere.test")).resolves.toBe(false);
  });

  it("rejects empty input", async () => {
    await expect(isSignInAllowed(null)).resolves.toBe(false);
    await expect(isSignInAllowed("")).resolves.toBe(false);
  });
});
