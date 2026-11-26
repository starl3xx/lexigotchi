CREATE TABLE "reminder_marks" (
	"account" text NOT NULL,
	"kind" text NOT NULL,
	"mark" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_marks_account_kind_mark_pk" PRIMARY KEY("account","kind","mark")
);
--> statement-breakpoint
CREATE TABLE "reminder_prefs" (
	"account" text PRIMARY KEY NOT NULL,
	"kinds" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"email_cadence" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
