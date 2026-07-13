import "../setup-env";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createPolicyVersion,
  getPolicy,
  ingestPolicyFile,
  listPolicies,
} from "@/ingest/policies";
import { createOrg, resetDb } from "../helpers/db";
import { makePdf } from "../helpers/fixtures";

describe("policy intake", () => {
  beforeEach(resetDb);

  it("stores pasted text with its sha256", async () => {
    const org = await createOrg("Org A");
    const policy = await createPolicyVersion({
      orgId: org.id,
      title: "Data Handling",
      text: "Staff must lock screens.\r\n",
      sourceKind: "text",
    });

    expect(policy.version).toBe(1);
    expect(policy.text).toBe("Staff must lock screens.");
    const expected = createHash("sha256")
      .update("Staff must lock screens.", "utf8")
      .digest("hex");
    expect(policy.sha256).toBe(expected);
  });

  it("a changed policy is a new version, never an edit", async () => {
    const org = await createOrg("Org A");
    const v1 = await createPolicyVersion({
      orgId: org.id,
      title: "Data Handling",
      text: "Version one text.",
      sourceKind: "text",
    });
    const v2 = await createPolicyVersion({
      orgId: org.id,
      title: "Data Handling",
      text: "Version two text.",
      sourceKind: "text",
    });

    expect(v2.version).toBe(2);
    expect(v2.id).not.toBe(v1.id);

    // v1 is untouched
    const v1Again = await getPolicy(org.id, v1.id);
    expect(v1Again?.text).toBe("Version one text.");
    expect(v1Again?.version).toBe(1);
  });

  it("rejects empty policies", async () => {
    const org = await createOrg("Org A");
    await expect(
      createPolicyVersion({
        orgId: org.id,
        title: "Empty",
        text: "   \n  ",
        sourceKind: "text",
      }),
    ).rejects.toThrow(/empty/);
  });

  it("ingests an uploaded PDF end to end", async () => {
    const org = await createOrg("Org A");
    const pdf = await makePdf([
      "Acceptable Use Policy",
      "Personal use of company laptops must be minimal.",
    ]);
    const policy = await ingestPolicyFile({
      orgId: org.id,
      title: "Acceptable Use",
      filename: "aup.pdf",
      contentType: "application/pdf",
      bytes: pdf,
    });

    expect(policy.sourceKind).toBe("pdf");
    expect(policy.text).toContain("company laptops");
    expect(policy.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(policy.sourceFileKey).toContain(`${org.id}/policies/`);
  });

  it("scopes reads by org (cross-tenant)", async () => {
    const orgA = await createOrg("Org A");
    const orgB = await createOrg("Org B");
    const secret = await createPolicyVersion({
      orgId: orgB.id,
      title: "B Secret Policy",
      text: "Only org B may see this.",
      sourceKind: "text",
    });

    expect(await getPolicy(orgA.id, secret.id)).toBeUndefined();
    const seenFromA = await listPolicies(orgA.id);
    expect(seenFromA).toHaveLength(0);
  });
});
