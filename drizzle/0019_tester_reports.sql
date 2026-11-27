CREATE TABLE "tester_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"chat_id" bigint NOT NULL,
	"message_id" bigint,
	"reporter_id" bigint NOT NULL,
	"reporter_name" text NOT NULL,
	"text" text NOT NULL,
	"photo_file_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tester_reports_created_idx" ON "tester_reports" USING btree ("created_at");