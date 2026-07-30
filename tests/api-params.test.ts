import { describe, expect, it } from 'vitest';

import {
  INT4_MAX,
  parseGroupId,
  parseMinMinutes,
  parsePersonId,
} from '@/lib/api/params';

/**
 * Regression tests for the three findings from the targeted API review.
 *
 * Pure parsing — no database, no HTTP. The live status codes these produce are asserted
 * in tests/api.test.ts against the running routes.
 */

describe('finding 1: out-of-int4-range personId must not reach the database', () => {
  /**
   * Postgres rejects a value the `integer` column cannot hold, and the driver's throw
   * surfaced as a 500 — for input that is plainly a client mistake. The brief requires
   * 400 for bad params and no 500s.
   */

  it('rejects int4 max + 1', () => {
    const result = parsePersonId('2147483648');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/2147483647|integer range/);
  });

  it('rejects an absurdly large value', () => {
    expect(parsePersonId('999999999999999999999').ok).toBe(false);
  });

  it('still ACCEPTS int4 max, so the route can 404 it honestly', () => {
    // The boundary must not be over-tightened: 2147483647 is a storable id that simply
    // is not in the table, which is a 404, not a 400.
    const result = parsePersonId(String(INT4_MAX));
    expect(result).toEqual({ ok: true, value: INT4_MAX });
  });

  it('accepts a real seeded personId', () => {
    expect(parsePersonId('1629008')).toEqual({ ok: true, value: 1629008 });
  });

  it('still rejects non-integers, zero and negatives', () => {
    for (const raw of ['abc', '1629008.5', '0', '-5', ' ', '']) {
      expect(parsePersonId(raw).ok, `expected ${JSON.stringify(raw)} to be rejected`)
        .toBe(false);
    }
  });
});

describe('finding 2: empty minMinutes must apply the default, not zero', () => {
  const DEFAULT = 50;

  it('applies the default when the parameter is absent', () => {
    expect(parseMinMinutes(null, DEFAULT)).toEqual({ ok: true, value: DEFAULT });
  });

  it('applies the default when the parameter is present but empty', () => {
    // Number('') is 0, which silently returned every unit above the emit floor and
    // ignored the documented default.
    expect(parseMinMinutes('', DEFAULT)).toEqual({ ok: true, value: DEFAULT });
  });

  it('applies the default for a whitespace-only value', () => {
    expect(parseMinMinutes('   ', DEFAULT)).toEqual({ ok: true, value: DEFAULT });
  });

  it('lets an explicit number override the default', () => {
    expect(parseMinMinutes('25', DEFAULT)).toEqual({ ok: true, value: 25 });
    expect(parseMinMinutes('33.7', DEFAULT)).toEqual({ ok: true, value: 33.7 });
  });

  it('accepts an explicit zero — that is a real request for everything', () => {
    // Distinct from the empty case: asking for 0 is deliberate, so it is honoured.
    expect(parseMinMinutes('0', DEFAULT)).toEqual({ ok: true, value: 0 });
  });

  it('still rejects nonsense', () => {
    for (const raw of ['abc', '-1', 'NaN', 'Infinity']) {
      expect(parseMinMinutes(raw, DEFAULT).ok, `expected ${raw} rejected`).toBe(false);
    }
  });
});

describe('finding 3: groupId parsing', () => {
  it('accepts the canonical form', () => {
    expect(parseGroupId('-1-2-3-4-5-')).toEqual({ ok: true, value: '-1-2-3-4-5-' });
  });

  it('accepts a URL-encoded groupId', () => {
    expect(parseGroupId('%2D1-2-3-4-5%2D')).toEqual({ ok: true, value: '-1-2-3-4-5-' });
  });

  it('rejects the wrong number of ids, missing dashes, and injection attempts', () => {
    for (const raw of [
      '-1-2-3-4-',
      '-1-2-3-4-5-6-',
      '1-2-3-4-5-',
      'not-a-lineup',
      "-1-2-3-4-5-'; DROP TABLE players;--",
    ]) {
      expect(parseGroupId(raw).ok, `expected ${JSON.stringify(raw)} rejected`).toBe(false);
    }
  });

  it('accepts a well-formed but UNSORTED five — shape is not identity', () => {
    // Parsing only checks shape. Whether those five in that order are a stored lineup is
    // a lookup question, and the 404 message must explain the real reason (see the route
    // test in api.test.ts).
    const scrambled = '-1642856-1629008-1641730-1629611-1629651-';
    expect(parseGroupId(scrambled)).toEqual({ ok: true, value: scrambled });
  });
});
