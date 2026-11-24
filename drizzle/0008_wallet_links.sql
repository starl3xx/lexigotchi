CREATE TABLE "wallet_link_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"account" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wallet_links" (
	"address" text PRIMARY KEY NOT NULL,
	"account" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "wallet_links_account_idx" ON "wallet_links" USING btree ("account");