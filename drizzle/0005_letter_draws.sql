CREATE TABLE "letter_draws" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"draw_key" text NOT NULL,
	"letter_indexes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "letter_draws_key_idx" ON "letter_draws" USING btree ("chain_id","draw_key");