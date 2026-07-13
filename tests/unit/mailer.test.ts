import { readFileSync, rmSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sendEmail } from "@/emails/mailer";

const MAILBOX = path.join(process.cwd(), ".dev-mail");

describe("mailer (dev mode, no RESEND_API_KEY)", () => {
  beforeEach(() => {
    rmSync(MAILBOX, { recursive: true, force: true });
  });
  afterEach(() => {
    rmSync(MAILBOX, { recursive: true, force: true });
  });

  it("writes the email to the dev mailbox instead of the network", async () => {
    delete process.env.RESEND_API_KEY;
    await sendEmail({
      to: "someone@example.test",
      subject: "Sign in to Attest",
      text: "Sign in: https://example.test/magic?token=abc",
    });

    expect(existsSync(MAILBOX)).toBe(true);
    const files = readdirSync(MAILBOX);
    expect(files.length).toBe(1);
    const first = files[0];
    if (!first) throw new Error("no mail file written");
    const body = JSON.parse(readFileSync(path.join(MAILBOX, first), "utf8")) as {
      to: string;
      text: string;
    };
    expect(body.to).toBe("someone@example.test");
    expect(body.text).toContain("token=abc");
  });
});
