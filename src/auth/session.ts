import { redirect } from "next/navigation";
import { auth } from "@/auth";

export interface OrgSession {
  userId: string;
  orgId: string;
  email: string;
  role: "admin" | "viewer";
}

/** Server-component/action guard: redirects to login unless the caller is an
 * org member. All org-scoped queries must use the returned orgId. */
export async function requireOrgSession(): Promise<OrgSession> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.orgId) redirect("/login?error=AccessDenied");
  return {
    userId: session.user.id,
    orgId: session.user.orgId,
    email: session.user.email,
    role: session.user.role,
  };
}

export async function requireAdmin(): Promise<OrgSession> {
  const session = await requireOrgSession();
  if (session.role !== "admin") redirect("/dashboard");
  return session;
}
