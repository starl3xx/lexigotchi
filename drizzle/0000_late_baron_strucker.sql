CREATE TABLE "campaign_cast_proofs" (
	"fid" integer PRIMARY KEY NOT NULL,
	"cast_hash" text NOT NULL,
	"cast_url" text,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pack_grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"fid" integer NOT NULL,
	"kind" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tx_hash" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"fid" integer PRIMARY KEY NOT NULL,
	"added_mini_app_at" timestamp with time zone,
	"notif_token" text,
	"notif_url" text,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pack_grants_fid_kind_unique" ON "pack_grants" USING btree ("fid","kind");