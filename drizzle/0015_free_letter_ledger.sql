ALTER TABLE "free_claims" ADD COLUMN "letters" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "free_claims" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "free_claims" ADD COLUMN "used" boolean;--> statement-breakpoint
UPDATE "free_claims" SET "letters" = 5 WHERE "kind" = 'pack';--> statement-breakpoint
UPDATE "free_claims" SET "expires_at" = "claimed_at" + interval '600 seconds' WHERE "expires_at" IS NULL;
