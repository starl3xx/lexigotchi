CREATE TABLE "word_listings" (
	"id" serial PRIMARY KEY NOT NULL,
	"maker" text NOT NULL,
	"token_id" text NOT NULL,
	"word" text NOT NULL,
	"price_wei" text NOT NULL,
	"claimed_at" bigint NOT NULL,
	"order_json" text NOT NULL,
	"signature" text NOT NULL,
	"order_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "word_listings_hash_idx" ON "word_listings" USING btree ("order_hash");--> statement-breakpoint
CREATE INDEX "word_listings_token_idx" ON "word_listings" USING btree ("token_id");