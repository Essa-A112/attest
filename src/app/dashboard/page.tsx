import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { db } from "@/db";
import { orgs } from "@/db/schema";
import { verifyChain } from "@/ledger/verify";

async function LedgerStatus({ orgId }: { orgId: string }) {
  const result = await verifyChain(orgId);
  return result.status === "intact" ? (
    <p style={{ color: "#15803d" }}>
      ✓ Chain intact — {result.rows} attempt{result.rows === 1 ? "" : "s"} recorded.
    </p>
  ) : (
    <p style={{ color: "#b91c1c" }}>
      ✗ Chain BROKEN at row {result.atSeq}: {result.reason}
    </p>
  );
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.orgId) redirect("/login?error=AccessDenied");

  const org = await db.query.orgs.findFirst({
    where: eq(orgs.id, session.user.orgId),
  });
  if (!org) redirect("/login?error=AccessDenied");

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <main className="container">
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          borderBottom: "1px solid var(--border)",
          paddingBottom: "1rem",
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>{org.name}</h1>
          <p style={{ margin: 0, color: "var(--muted)" }}>
            Signed in as {session.user.email} ({session.user.role})
          </p>
        </div>
        <form action={logout}>
          <button type="submit">Sign out</button>
        </form>
      </header>
      <section style={{ marginTop: "2rem" }}>
        <h2>Policies</h2>
        <p>
          <Link href="/dashboard/policies">Manage policies</Link> &mdash; upload
          or paste a policy to start building training from it.
        </p>
      </section>
      <section style={{ marginTop: "2rem" }}>
        <h2>Completion ledger</h2>
        <LedgerStatus orgId={session.user.orgId} />
      </section>
    </main>
  );
}
