CREATE TABLE "swap_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"maker" text NOT NULL,
	"give_id" integer NOT NULL,
	"want_id" integer NOT NULL,
	"order_json" text NOT NULL,
	"signature" text NOT NULL,
	"order_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "swap_orders_hash_idx" ON "swap_orders" USING btree ("order_hash");