/**
 * Vitest setup.
 *
 * Loads `.env.local` / `.env` so DB-backed tests can reach Neon with the same precedence
 * as every other standalone tool in the project. Importing the shared loader rather than
 * calling dotenv here keeps one place responsible for that rule.
 *
 * The API tests deliberately FAIL rather than skip when the database is unreachable — see
 * the `beforeAll` in tests/api.test.ts. A test that can silently skip is a test that isn't
 * really committed.
 */
import './src/db/env';
