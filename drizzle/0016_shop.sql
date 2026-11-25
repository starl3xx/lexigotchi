CREATE TABLE "shop_index" (
	"chain_id" integer NOT NULL,
	"shop" text NOT NULL,
	"last_block" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_index_chain_id_shop_pk" PRIMARY KEY("chain_id","shop")
);
--> statement-breakpoint
CREATE TABLE "shop_items" (
	"chain_id" integer NOT NULL,
	"shop" text NOT NULL,
	"item_id" integer NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"art" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_items_chain_id_shop_item_id_pk" PRIMARY KEY("chain_id","shop","item_id")
);
--> statement-breakpoint
CREATE TABLE "wardrobe" (
	"chain_id" integer NOT NULL,
	"shop" text NOT NULL,
	"item_id" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"buyer" text NOT NULL,
	"recipient" text NOT NULL,
	"profile" text NOT NULL,
	"price_usdc" bigint NOT NULL,
	"to_studio" bigint NOT NULL,
	"word_to_pool" text NOT NULL,
	"deferred_usdc" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wardrobe_chain_id_tx_hash_log_index_pk" PRIMARY KEY("chain_id","tx_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "word_picks" (
	"profile" text NOT NULL,
	"word" text NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "word_picks_profile_word_kind_pk" PRIMARY KEY("profile","word","kind")
);
--> statement-breakpoint
CREATE INDEX "wardrobe_recipient_idx" ON "wardrobe" USING btree ("chain_id","shop","recipient");--> statement-breakpoint
CREATE INDEX "wardrobe_profile_idx" ON "wardrobe" USING btree ("chain_id","shop","profile");--> statement-breakpoint
-- Move every saved scene pick from the wallet that held the word to that wallet's profile (its
-- account's first wallet, or the wallet itself when unlinked). When two wallets of one profile picked
-- for the same word, the newer pick wins, as it does everywhere else. word_scenes stays, for a rollback.
INSERT INTO "word_picks" ("profile", "word", "kind", "value", "updated_at")
SELECT DISTINCT ON (COALESCE(l."account", s."wallet"), s."word")
	COALESCE(l."account", s."wallet"), s."word", 'scene', s."scene", s."updated_at"
FROM "word_scenes" s
LEFT JOIN "wallet_links" l ON l."address" = s."wallet"
ORDER BY COALESCE(l."account", s."wallet"), s."word", s."updated_at" DESC
ON CONFLICT DO NOTHING;
