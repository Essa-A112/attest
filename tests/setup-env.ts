// Loads .env for local test runs; CI provides env vars directly.
import "dotenv/config";

process.env.DATABASE_URL ??= "postgres://attest:attest@localhost:5432/attest";
// Tests always use the owner connection: fixtures truncate tables, which the
// restricted runtime role deliberately cannot do. The grants themselves are
// asserted in the ledger suite through an explicit attest_app connection.
process.env.APP_DATABASE_URL = process.env.DATABASE_URL;
