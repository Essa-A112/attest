import Link from "next/link";
import { requireAdmin } from "@/auth/session";
import { createPolicy } from "../actions";

export default async function NewPolicyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin();
  const { error } = await searchParams;

  return (
    <main className="container">
      <p>
        <Link href="/dashboard/policies">&larr; Policies</Link>
      </p>
      <h1>Add a policy</h1>
      <p style={{ color: "var(--muted)" }}>
        Uploading a policy with an existing title creates a new version; earlier
        versions are never edited.
      </p>
      {error ? (
        <p role="alert" style={{ color: "#b91c1c" }}>
          {error}
        </p>
      ) : null}
      <form action={createPolicy}>
        <p>
          <label htmlFor="title">Title</label>
          <br />
          <input
            id="title"
            name="title"
            required
            style={{ padding: "0.5rem", minWidth: "24rem" }}
          />
        </p>
        <p>
          <label htmlFor="file">Upload PDF or docx</label>
          <br />
          <input id="file" name="file" type="file" accept=".pdf,.docx" />
        </p>
        <p style={{ color: "var(--muted)" }}>&mdash; or &mdash;</p>
        <p>
          <label htmlFor="text">Paste policy text</label>
          <br />
          <textarea
            id="text"
            name="text"
            rows={12}
            style={{ padding: "0.5rem", width: "100%", maxWidth: "40rem" }}
          />
        </p>
        <button type="submit" style={{ padding: "0.5rem 1rem" }}>
          Store policy
        </button>
      </form>
    </main>
  );
}
