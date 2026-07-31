import { describe, expect, it } from 'vitest';

import { grainUrl, unitForGrain } from '@/lib/nav/routes';

/**
 * Scope routing.
 *
 * Sending a grain to the wrong endpoint is the defect this stage could most plausibly
 * ship, and it is invisible: `/api/player/123` and `/api/lineup/...` both return a valid
 * `GrainResponse`, so the wrong one renders as a perfectly convincing plate of the wrong
 * subject. Pure functions, no DB, no browser — nothing here can skip.
 */

describe('grain → endpoint', () => {
  it('sends each grain to its own endpoint', () => {
    expect(grainUrl('team', null)).toBe('/api/team');
    expect(grainUrl('lineup', '-1-2-3-4-5-')).toBe('/api/lineup/-1-2-3-4-5-');
    expect(grainUrl('player', 1629008)).toBe('/api/player/1629008');
  });

  it('never routes a lineup to the player endpoint or the reverse', () => {
    // The failure mode is silent, so assert the negative explicitly.
    expect(grainUrl('lineup', '-1-2-3-4-5-')).not.toContain('/player/');
    expect(grainUrl('player', 1629008)).not.toContain('/lineup/');
  });

  it('ignores any unit id on the team grain', () => {
    // Team is the whole roster — a stale lineup selection must not leak into its URL.
    expect(grainUrl('team', '-1-2-3-4-5-')).toBe('/api/team');
    expect(grainUrl('team', 1629008)).toBe('/api/team');
  });

  it('refuses to fetch a narrow grain with no selection', () => {
    // Returning a URL here would request `/api/player/` and surface a 404 that looks like
    // a server fault rather than an incomplete selection.
    expect(grainUrl('lineup', null)).toBeNull();
    expect(grainUrl('player', null)).toBeNull();
    expect(grainUrl('lineup', '')).toBeNull();
  });

  it('encodes the group id rather than interpolating it raw', () => {
    // Group ids are dash-delimited today, but the URL must not be constructible by input.
    expect(grainUrl('lineup', 'a/b?c=d')).toBe('/api/lineup/a%2Fb%3Fc%3Dd');
  });
});

describe('landing selection when switching grain', () => {
  it('falls back to the first available unit', () => {
    // Switching to lineup with nothing remembered must land on a plate, not an empty one.
    expect(unitForGrain(null, '-1-2-3-4-5-')).toBe('-1-2-3-4-5-');
    expect(unitForGrain(null, 1629008)).toBe(1629008);
  });

  it('keeps a previous choice over the default', () => {
    expect(unitForGrain('-9-9-9-9-9-', '-1-2-3-4-5-')).toBe('-9-9-9-9-9-');
  });

  it('reports null when there is nothing to select at all', () => {
    // An empty catalog must produce "no fetch", not a request for undefined.
    expect(unitForGrain(null, undefined)).toBeNull();
  });
});
