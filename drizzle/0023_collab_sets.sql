CREATE TABLE "set_allowlist" (
	"set_id" integer NOT NULL,
	"wallet" text NOT NULL,
	CONSTRAINT "set_allowlist_set_id_wallet_pk" PRIMARY KEY("set_id","wallet")
);
--> statement-breakpoint
CREATE TABLE "set_stamps" (
	"set_id" integer PRIMARY KEY NOT NULL,
	"mime" text NOT NULL,
	"data" text NOT NULL,
	"bytes" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "word_sets" ADD COLUMN "type" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "word_sets" ADD COLUMN "partner_name" text;--> statement-breakpoint
ALTER TABLE "word_sets" ADD COLUMN "partner_url" text;--> statement-breakpoint
ALTER TABLE "word_sets" ADD COLUMN "color_a" text;--> statement-breakpoint
ALTER TABLE "word_sets" ADD COLUMN "color_b" text;--> statement-breakpoint
ALTER TABLE "word_sets" ADD COLUMN "gate_rule" text DEFAULT 'verified' NOT NULL;--> statement-breakpoint
ALTER TABLE "word_sets" ADD COLUMN "gate_token" text;--> statement-breakpoint
ALTER TABLE "word_sets" ADD COLUMN "gate_min" text;--> statement-breakpoint
ALTER TABLE "word_sets" ADD COLUMN "gate_label" text;--> statement-breakpoint
ALTER TABLE "set_allowlist" ADD CONSTRAINT "set_allowlist_set_id_word_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."word_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_stamps" ADD CONSTRAINT "set_stamps_set_id_word_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."word_sets"("id") ON DELETE cascade ON UPDATE no action;