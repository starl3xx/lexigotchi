CREATE TABLE "word_scenes" (
	"wallet" text NOT NULL,
	"word" text NOT NULL,
	"scene" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "word_scenes_wallet_word_pk" PRIMARY KEY("wallet","word")
);
