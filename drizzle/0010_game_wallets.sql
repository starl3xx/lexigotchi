CREATE TABLE "game_wallets" (
	"account" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"chosen_at" timestamp with time zone DEFAULT now() NOT NULL
);
