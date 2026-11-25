ALTER TABLE "free_claims" ADD COLUMN "letters" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "free_claims" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "free_claims" ADD COLUMN "used" boolean;--> statement-breakpoint
ALTER TABLE "free_claims" ADD COLUMN "wallet" text;--> statement-breakpoint
ALTER TABLE "free_claims" ADD COLUMN "profile" text;--> statement-breakpoint
CREATE INDEX "free_claims_wallet" ON "free_claims" USING btree ("chain_id","wallet");--> statement-breakpoint
CREATE INDEX "free_claims_profile" ON "free_claims" USING btree ("chain_id","profile");--> statement-breakpoint
UPDATE "free_claims" SET "letters" = 5 WHERE "kind" = 'pack';--> statement-breakpoint
UPDATE "free_claims" SET "expires_at" = "claimed_at" + interval '600 seconds' WHERE "expires_at" IS NULL;--> statement-breakpoint
UPDATE "free_claims" SET "profile" = "account" WHERE "profile" IS NULL;
