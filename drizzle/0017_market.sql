CREATE TABLE "letter_listings" (
	"id" serial PRIMARY KEY NOT NULL,
	"maker" text NOT NULL,
	"letter_id" integer NOT NULL,
	"qty" integer NOT NULL,
	"unit_price_wei" numeric(78, 0) NOT NULL,
	"order_json" text NOT NULL,
	"signature" text NOT NULL,
	"order_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_sales" (
	"chain_id" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"sold_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"order_hash" text NOT NULL,
	"seller" text NOT NULL,
	"buyer" text NOT NULL,
	"word" text,
	"tier" text,
	"letter_id" integer,
	"qty" integer NOT NULL,
	"price_wei" numeric(78, 0) NOT NULL,
	"fee_wei" numeric(78, 0) NOT NULL,
	CONSTRAINT "market_sales_chain_id_tx_hash_log_index_pk" PRIMARY KEY("chain_id","tx_hash","log_index")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "letter_listings_hash_idx" ON "letter_listings" USING btree ("order_hash");--> statement-breakpoint
CREATE INDEX "letter_listings_book_idx" ON "letter_listings" USING btree ("letter_id","unit_price_wei");--> statement-breakpoint
CREATE INDEX "letter_listings_maker_idx" ON "letter_listings" USING btree ("maker");--> statement-breakpoint
CREATE INDEX "market_sales_recent_idx" ON "market_sales" USING btree ("chain_id","sold_at");--> statement-breakpoint
CREATE INDEX "market_sales_letter_idx" ON "market_sales" USING btree ("chain_id","letter_id","sold_at");--> statement-breakpoint
CREATE INDEX "market_sales_word_idx" ON "market_sales" USING btree ("chain_id","word","sold_at");