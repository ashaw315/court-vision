/**
 * Request-parameter parsing, shared by the route handlers.
 *
 * Extracted from the routes so the rules are unit-testable without HTTP, and so the same
 * validation cannot drift between endpoints.
 *
 * Each parser returns either a value or an error string. The caller turns the string into
 * a 400 — parsing never throws, because an unparseable parameter is a client mistake, not
 * a server fault.
 */

/**
 * Postgres `integer` is int4. A value outside that range is not "a player we don't have",
 * it is a value the column cannot hold — and passing it through made the driver throw,
 * surfacing as a 500 for what is plainly bad input. Range-checking here keeps that a 400.
 */
export const INT4_MAX = 2_147_483_647;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * A personId: a positive integer inside Postgres int4 range.
 *
 * Note `Number()` accepts hex ("0x10") and exponent ("1e9") forms. That is left alone:
 * both produce a well-defined integer, and an id that is simply not in the table gets an
 * honest 404. The range check is what matters, because out-of-range is the case the
 * database itself rejects.
 */
export function parsePersonId(raw: string): Parsed<number> {
  const value = Number(raw);

  if (!Number.isInteger(value) || value <= 0) {
    return {
      ok: false,
      error: `personId must be a positive integer, got ${JSON.stringify(raw)}`,
    };
  }

  if (value > INT4_MAX) {
    return {
      ok: false,
      error:
        `personId must be at most ${INT4_MAX} (Postgres integer range), got `
        + `${JSON.stringify(raw)}`,
    };
  }

  return { ok: true, value };
}

/** Identity form: "-id-id-id-id-id-", person ids sorted ascending. */
const GROUP_ID = /^-(\d+-){5}$/;

export function parseGroupId(raw: string): Parsed<string> {
  const groupId = decodeURIComponent(raw);
  if (!GROUP_ID.test(groupId)) {
    return {
      ok: false,
      error:
        'groupId must be five dash-delimited person ids, e.g. "-1-2-3-4-5-", got '
        + JSON.stringify(groupId),
    };
  }
  return { ok: true, value: groupId };
}

/**
 * The lineup display threshold.
 *
 * A MISSING or EMPTY parameter means "apply the default" — not zero. `Number('')` is 0,
 * which silently returned every unit above the emit floor instead of the documented
 * default, so the empty case is checked before coercion. Only an explicit, valid number
 * overrides the default.
 */
export function parseMinMinutes(raw: string | null, fallback: number): Parsed<number> {
  if (raw === null || raw.trim() === '') {
    return { ok: true, value: fallback };
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    return {
      ok: false,
      error: `minMinutes must be a non-negative number, got ${JSON.stringify(raw)}`,
    };
  }

  return { ok: true, value };
}
