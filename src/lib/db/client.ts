/**
 * Drizzle client over Neon Postgres (postgres-js), mirroring LHAW.
 *
 * Server-only — never import this from a client component (it reads `DATABASE_URL` and pulls in the
 * node `postgres` driver). Use Neon's POOLED endpoint (`DATABASE_URL`, pgbouncer) for the app, which
 * requires `prepare: false`. The client is created lazily and cached on `globalThis`, so dev HMR and
 * warm serverless instances reuse a single pool instead of exhausting connections.
 */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForPg = globalThis as unknown as { __lexiPg?: ReturnType<typeof postgres> };

let _db: PostgresJsDatabase<typeof schema> | null = null;

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — add it to .env.local (see .env.example).");
  const client = globalForPg.__lexiPg ?? postgres(url, { prepare: false });
  if (process.env.NODE_ENV !== "production") globalForPg.__lexiPg = client;
  _db = drizzle(client, { schema });
  return _db;
}

export { schema };
