import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface Email {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const DEV_MAILBOX_DIR = path.join(process.cwd(), ".dev-mail");

/**
 * Sends email via the Resend API when RESEND_API_KEY is set. Without a key
 * (local dev, CI) it writes the message to `.dev-mail/` so magic links can be
 * picked up by a human or a test without any credential leaving the process.
 * Email bodies contain magic-link tokens, so they are never logged.
 */
export async function sendEmail(email: Email): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "Attest <onboarding@resend.dev>";

  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("RESEND_API_KEY is required in production");
    }
    mkdirSync(DEV_MAILBOX_DIR, { recursive: true });
    const file = path.join(
      DEV_MAILBOX_DIR,
      `${Date.now()}-${email.to.replaceAll(/[^a-zA-Z0-9@.-]/g, "_")}.json`,
    );
    writeFileSync(file, JSON.stringify(email, null, 2));
    console.log(`[mailer] dev mode: wrote email for ${email.to} to ${file}`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email.to],
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
  });

  if (!res.ok) {
    // Never include the email body (it carries the magic link) in the error.
    throw new Error(`Resend API error: ${res.status} for message to ${email.to}`);
  }
}
