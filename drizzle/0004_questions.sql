CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"obligation_id" uuid NOT NULL,
	"scenario" text NOT NULL,
	"options" jsonb NOT NULL,
	"correct" integer NOT NULL,
	"rationale" text NOT NULL,
	"source_quote" text NOT NULL,
	"source_offsets" jsonb NOT NULL,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"check_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checker_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_obligation_id_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."obligations"("id") ON DELETE no action ON UPDATE no action;