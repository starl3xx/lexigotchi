CREATE TABLE "email_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"address" text PRIMARY KEY NOT NULL,
	"x_user_id" text,
	"x_username" text,
	"x_name" text,
	"x_pfp_url" text,
	"x_created_at" timestamp with time zone,
	"x_linked_at" timestamp with time zone,
	"name_source" text,
	"email" text,
	"email_verified_at" timestamp with time zone,
	"email_reminders" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "x_link_states" (
	"state" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"code_verifier" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "email_codes_address_idx" ON "email_codes" USING btree ("address");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_x_user_idx" ON "profiles" USING btree ("x_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_email_idx" ON "profiles" USING btree ("email");