import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/db";
import { accounts, sessions, users, verificationTokens, type UserRole } from "@/db/schema";
import { sendEmail } from "@/emails/mailer";
import { isSignInAllowed } from "./access";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      orgId: string | null;
      role: UserRole;
      name?: string | null;
      image?: string | null;
    };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "database" },
  trustHost: true,
  providers: [
    Resend({
      from: process.env.EMAIL_FROM ?? "Attest <onboarding@resend.dev>",
      // Route through our mailer so dev/CI work without a Resend key and the
      // magic link never hits logs.
      async sendVerificationRequest({ identifier, url }) {
        await sendEmail({
          to: identifier,
          subject: "Sign in to Attest",
          text: `Sign in to Attest:\n\n${url}\n\nIf you did not request this, ignore this email.`,
          html: `<p>Sign in to Attest:</p><p><a href="${url}">Sign in</a></p><p>If you did not request this, ignore this email.</p>`,
        });
      },
    }),
  ],
  pages: {
    signIn: "/login",
    verifyRequest: "/login/check-email",
    error: "/login",
  },
  callbacks: {
    async signIn({ user }) {
      return isSignInAllowed(user.email);
    },
    session({ session, user }) {
      const row = user as typeof user & { orgId: string | null; role: UserRole };
      session.user.id = row.id;
      session.user.orgId = row.orgId;
      session.user.role = row.role;
      return session;
    },
  },
});
