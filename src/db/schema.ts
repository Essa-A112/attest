// Drizzle schema. Tables are added per vertical slice; see docs/attest-architecture.md
// for the full data model this converges on.

import {
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  retentionDays: integer("retention_days").notNull().default(365),
});

export const userRoles = ["admin", "viewer"] as const;
export type UserRole = (typeof userRoles)[number];

// Admin-side users (HR / compliance staff). Trainees are NOT users; they live in
// the `trainees` table (issue 7) and authenticate via assignment magic links.
// Extra columns beyond the data model (emailVerified, name, image) belong to the
// Auth.js adapter contract.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => orgs.id),
  email: text("email").notNull().unique(),
  role: text("role", { enum: userRoles }).notNull().default("admin"),
  name: text("name"),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
});

// --- Auth.js adapter tables (shape dictated by @auth/drizzle-adapter) ---

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [primaryKey({ columns: [table.provider, table.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const policies = pgTable(
  "policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    title: text("title").notNull(),
    version: integer("version").notNull(),
    // Canonical extracted text. sha256 is computed over exactly this string;
    // it is what obligations quote against and what the evidence pack cites.
    text: text("text").notNull(),
    sourceFileKey: text("source_file_key"),
    sourceKind: text("source_kind", { enum: ["pdf", "docx", "text"] }).notNull(),
    sha256: text("sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("policies_org_title_version_idx").on(
      table.orgId,
      table.title,
      table.version,
    ),
  ],
);

export const courseStatuses = ["draft", "published", "retired"] as const;
export type CourseStatus = (typeof courseStatuses)[number];

export const generationStatuses = [
  "pending",
  "extracting",
  "generating",
  "checking",
  "ready",
  "failed",
] as const;
export type GenerationStatus = (typeof generationStatuses)[number];

export const courses = pgTable("courses", {
  id: uuid("id").primaryKey().defaultRandom(),
  policyId: uuid("policy_id")
    .notNull()
    .references(() => policies.id),
  // Mirrors the policy version the course was generated from.
  version: integer("version").notNull(),
  status: text("status", { enum: courseStatuses }).notNull().default("draft"),
  passMark: integer("pass_mark").notNull().default(80),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  generationStatus: text("generation_status", { enum: generationStatuses })
    .notNull()
    .default("pending"),
  generationError: text("generation_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Verified output of pass A. Questions reference obligations; the trainee brief
// lists them. Not in the original data-model sketch, but questions.obligation_id
// needs a referent and the brief needs a source.
export const obligations = pgTable("obligations", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseId: uuid("course_id")
    .notNull()
    .references(() => courses.id),
  // Model-assigned id within the extraction ("OB-1"...), unique per course.
  label: text("label").notNull(),
  statement: text("statement").notNull(),
  quote: text("quote").notNull(),
  offsets: jsonb("offsets").$type<[number, number]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reviewStatuses = ["pending", "approved", "edited", "rejected"] as const;
export type ReviewStatus = (typeof reviewStatuses)[number];

export const questions = pgTable("questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseId: uuid("course_id")
    .notNull()
    .references(() => courses.id),
  obligationId: uuid("obligation_id")
    .notNull()
    .references(() => obligations.id),
  scenario: text("scenario").notNull(),
  options: jsonb("options").$type<string[]>().notNull(),
  correct: integer("correct").notNull(),
  rationale: text("rationale").notNull(),
  sourceQuote: text("source_quote").notNull(),
  sourceOffsets: jsonb("source_offsets").$type<[number, number]>().notNull(),
  reviewStatus: text("review_status", { enum: reviewStatuses })
    .notNull()
    .default("pending"),
  // Pass C output: programmatic + checker-model flags. Flagged questions are
  // never discarded; the admin review gate is the final validator.
  checkFlags: jsonb("check_flags").$type<string[]>().notNull().default([]),
  checkerNotes: text("checker_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const generationRuns = pgTable("generation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseId: uuid("course_id")
    .notNull()
    .references(() => courses.id),
  pass: text("pass", { enum: ["A", "B", "C"] }).notNull(),
  input: jsonb("input").notNull(),
  output: jsonb("output").notNull(),
  modelVersion: text("model_version").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);
