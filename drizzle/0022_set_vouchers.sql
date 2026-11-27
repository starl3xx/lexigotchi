CREATE TABLE "set_vouchers" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"set_id" integer NOT NULL,
	"account" text NOT NULL,
	"wallet" text NOT NULL,
	"named" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"word" text NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"used" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "set_vouchers" ADD CONSTRAINT "set_vouchers_set_id_word_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."word_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "set_vouchers_account_word" ON "set_vouchers" USING btree ("chain_id","set_id","account","word");--> statement-breakpoint
CREATE INDEX "set_vouchers_wallet_idx" ON "set_vouchers" USING btree ("chain_id","set_id","wallet");