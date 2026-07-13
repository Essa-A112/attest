// Loads .env for local test runs; CI provides env vars directly.
import "dotenv/config";

process.env.DATABASE_URL ??= "postgres://attest:attest@localhost:5432/attest";
process.env.APP_DATABASE_URL ??= process.env.DATABASE_URL;
