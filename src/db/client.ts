import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

import * as schema from './schema';

// Driver choice: @neondatabase/serverless over node-postgres.
// The app deploys to Vercel, where route handlers run in short-lived serverless
// invocations that cannot hold a TCP connection pool across requests. Neon's HTTP
// driver issues each query over a stateless fetch, which is the right fit for that
// execution model. `postgres`/`pg` would mean pool-per-invocation churn for no gain
// — this app makes single-shot reads, no transactions and no long-lived sessions.

type DbClient = ReturnType<typeof drizzle<typeof schema>>;

let client: DbClient | undefined;

/**
 * Returns the Drizzle client, creating it on first call.
 *
 * Lazy on purpose: `next build` imports route modules to collect metadata, and a
 * client constructed at module scope would demand DATABASE_URL at build time on a
 * machine that has no reason to hold the database credential. Resolving the env var
 * inside the call defers that requirement to an actual request.
 */
export function getDb(): DbClient {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
    }
    client = drizzle(neon(url), { schema });
  }
  return client;
}
