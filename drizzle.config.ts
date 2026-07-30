import { defineConfig } from 'drizzle-kit';

// Loads .env.local / .env for standalone tooling — drizzle-kit does not do this itself.
import { databaseUrl } from './src/db/env';

// Migrations are generated/applied from a local machine, never from the deployed
// app — same separation as the ETL (stats.nba.com 403s from cloud IPs, and the
// deployed app only ever reads from Postgres).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: databaseUrl(),
  },
  verbose: true,
  strict: true,
});
