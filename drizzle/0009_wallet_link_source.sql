ALTER TABLE "wallet_links" ADD COLUMN "via" text DEFAULT 'signature' NOT NULL;--> statement-breakpoint
ALTER TABLE "wallet_links" ADD COLUMN "fid" integer;
