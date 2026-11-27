CREATE TABLE "dictionary_roots" (
	"chain_id" integer NOT NULL,
	"root" text NOT NULL,
	"held" jsonb NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dictionary_roots_chain_id_root_pk" PRIMARY KEY("chain_id","root")
);
--> statement-breakpoint
CREATE TABLE "set_words" (
	"chain_id" integer NOT NULL,
	"word" text NOT NULL,
	"set_id" integer NOT NULL,
	"headliner" boolean DEFAULT false NOT NULL,
	CONSTRAINT "set_words_chain_id_word_pk" PRIMARY KEY("chain_id","word")
);
--> statement-breakpoint
CREATE TABLE "word_sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"reveal_at" timestamp with time zone,
	"release_at" timestamp with time zone,
	"gate_hours" integer DEFAULT 24 NOT NULL,
	"per_player_limit" integer DEFAULT 1 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"revealed_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"gate_until" timestamp with time zone,
	"release_block" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "set_words" ADD CONSTRAINT "set_words_set_id_word_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."word_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "set_words_set_idx" ON "set_words" USING btree ("set_id");--> statement-breakpoint
CREATE INDEX "word_sets_chain_idx" ON "word_sets" USING btree ("chain_id","sort");