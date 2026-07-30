import { NextResponse } from 'next/server';
import type { z } from 'zod';

/**
 * Response helpers shared by every route handler.
 *
 * Two jobs: validate what we are about to send against the Phase 2 contract, and make sure
 * a failure never leaks a stack trace to the client.
 */

/**
 * Validate a payload against its schema, then send it.
 *
 * A response that does not match the contract is a SERVER bug, so it returns 500 — but a
 * 500 with a generic message. The real Zod issues go to the server log where they are
 * useful, never to the client where they would expose internals.
 *
 * This is the fourth place the contract is enforced (ETL emit, seed, tests, here). The
 * point is that the frontend can trust the shape absolutely: it is checked on the way out,
 * not merely assumed from the type annotation.
 */
export function validated<T>(
  schema: z.ZodType<T>,
  payload: unknown,
  init?: ResponseInit,
): NextResponse {
  const result = schema.safeParse(payload);
  if (!result.success) {
    console.error(
      'API response failed contract validation:',
      JSON.stringify(result.error.issues),
    );
    return NextResponse.json(
      { error: 'Internal error: response failed contract validation' },
      { status: 500 },
    );
  }
  return NextResponse.json(result.data, init);
}

/** 404 — the id is well-formed but nothing matches it. */
export function notFound(detail: string): NextResponse {
  return NextResponse.json({ error: 'Not found', detail }, { status: 404 });
}

/** 400 — the request itself is malformed. */
export function badRequest(detail: string): NextResponse {
  return NextResponse.json({ error: 'Bad request', detail }, { status: 400 });
}

/**
 * Last-resort handler for an unexpected throw.
 *
 * Logs the real error server-side; returns a generic message. A database error message can
 * carry schema details or even connection strings, so it never reaches the client.
 */
export function serverError(error: unknown, context: string): NextResponse {
  console.error(`API error in ${context}:`, error);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
