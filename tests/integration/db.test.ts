import "../setup-env";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db";

describe("database connectivity", () => {
  it("connects and answers a trivial query", async () => {
    const result = await db.execute(sql`select 1 as one`);
    expect(result[0]).toEqual({ one: 1 });
  });
});
