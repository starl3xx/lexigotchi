CREATE TABLE "free_claims" (
	"chain_id" integer NOT NULL,
	"account" text NOT NULL,
	"kind" text NOT NULL,
	"period" integer NOT NULL,
	"claim_key" text NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "free_claims_account_kind_period" ON "free_claims" USING btree ("chain_id","account","kind","period");
