CREATE TABLE "wallet_sightings" (
	"address" text PRIMARY KEY NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"days_seen" integer DEFAULT 1 NOT NULL,
	"last_day" integer NOT NULL,
	"first_via" text NOT NULL,
	"last_via" text NOT NULL,
	"fid" integer
);
--> statement-breakpoint
CREATE INDEX "wallet_sightings_first_seen_idx" ON "wallet_sightings" USING btree ("first_seen_at");