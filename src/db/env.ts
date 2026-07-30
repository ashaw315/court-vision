import path from 'node:path';

import { config } from 'dotenv';

/**
 * Loads DATABASE_URL for STANDALONE tooling (drizzle-kit, the seed script).
 *
 * The Next app loads `.env.local` and `.env` automatically; standalone Node processes do
 * not, so `drizzle-kit generate/migrate` and `seed.ts` would otherwise see an undefined
 * connection string and fail with a confusing error. This module is the one place that
 * gap is closed.
 *
 * Both files are loaded, `.env.local` first: dotenv does not overwrite an already-set
 * variable, so `.env.local` wins where the two disagree — matching Next's own precedence.
 * A variable already exported in the shell beats both, which is what you want for a
 * one-off `DATABASE_URL=... npm run db:migrate`.
 *
 * Neither file is committed (both are gitignored); `.env.example` documents the variable.
 */

const ROOT = process.cwd();

config({ path: path.join(ROOT, '.env.local'), quiet: true });
config({ path: path.join(ROOT, '.env'), quiet: true });

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and fill it in '
        + '(see src/db/env.ts for how standalone tooling loads it).',
    );
  }
  return url;
}
