import { signIn } from "@/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  async function login(formData: FormData) {
    "use server";
    const email = formData.get("email");
    if (typeof email !== "string" || email.length === 0) return;
    await signIn("resend", { email: email.toLowerCase(), redirectTo: "/dashboard" });
  }

  return (
    <main className="container">
      <h1>Sign in to Attest</h1>
      <p>Enter your work email and we&apos;ll send you a sign-in link.</p>
      {error ? (
        <p role="alert" style={{ color: "#b91c1c" }}>
          {error === "AccessDenied"
            ? "That email is not registered with any organisation."
            : "Sign-in failed. Please try again."}
        </p>
      ) : null}
      <form action={login}>
        <label htmlFor="email">Email</label>
        <br />
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          style={{ padding: "0.5rem", minWidth: "20rem", margin: "0.5rem 0" }}
        />
        <br />
        <button type="submit" style={{ padding: "0.5rem 1rem" }}>
          Send magic link
        </button>
      </form>
    </main>
  );
}
