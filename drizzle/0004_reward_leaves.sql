CREATE TABLE "reward_leaves" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"stream" text NOT NULL,
	"epoch_id" text NOT NULL,
	"root" text NOT NULL,
	"token_id" text NOT NULL,
	"account" text NOT NULL,
	"amount" text NOT NULL,
	"proof" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "reward_leaves_leaf_idx" ON "reward_leaves" USING btree ("chain_id","stream","epoch_id","token_id");--> statement-breakpoint
CREATE INDEX "reward_leaves_account_idx" ON "reward_leaves" USING btree ("chain_id","account");