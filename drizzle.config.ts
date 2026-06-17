import { config } from "dotenv";
import type { Config } from "drizzle-kit";

// drizzle-kit's CLI doesn't auto-load env files; pull local secrets for generate/migrate.
config({ path: ".env.local" });

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // DDL/migrations run best against Neon's DIRECT (unpooled) endpoint; fall back to the pooled URL.
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "" },
} satisfies Config;
