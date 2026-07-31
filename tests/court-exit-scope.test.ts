import { describe, expect, it } from 'vitest';

/**
 * The court's slide-out must never replay under a different scope's heading.
 *
 * Measured defect (Stage 6a follow-up, frame-cadence CDP polling): after switching grain
 * while a connection was selected, the court kept rendering the PREVIOUS grain's
 * connection — "CLAXTON → PORTER JR. · 94 BASKETS" — underneath a header that already read
 * "FIVE-MAN UNIT". 12 of 90 sampled frames (~300-400ms) showed that contradiction.
 *
 * Two distinct bugs produced it:
 *   1. The exit animation held the outgoing connection for COURT_SLIDE_MS regardless of
 *      whether the clear was a deselect or a scope change.
 *   2. The effect stamped the outgoing connection with the NEW scopeKey, so a guard
 *      comparing keys matched and slid the stale court back in one frame after it had
 *      correctly cleared.
 *
 * This models the decision both fixes turn on: play the exit only when the connection was
 * cleared WITHIN one scope.
 */

/** The rule the component implements: an exit is honest only inside a single scope. */
function shouldPlayExit(
  was: { connection: unknown; scopeKey: string },
  connection: unknown,
  scopeKey: string,
  animate: boolean,
): boolean {
  return Boolean(was.connection) && !connection && animate && was.scopeKey === scopeKey;
}

const CONN = { assisterId: 1, shooterId: 2 };

describe('exit animation is scoped', () => {
  it('plays when a connection is deselected within one scope', () => {
    expect(shouldPlayExit({ connection: CONN, scopeKey: 'team:team' }, null, 'team:team', true))
      .toBe(true);
  });

  it('does NOT play when the scope changed', () => {
    // The measured bug: team-grain court sliding out under a lineup-grain header.
    expect(
      shouldPlayExit({ connection: CONN, scopeKey: 'team:team' }, null, 'lineup:-1-2-3-4-5-', true),
    ).toBe(false);
  });

  it('does not resurrect the old connection when the key is stamped with the NEW scope', () => {
    // Bug 2 in isolation: stamping `scopeKey` (new) instead of `was.scopeKey` (old) made
    // the comparison trivially true and reintroduced the stale frame.
    const was = { connection: CONN, scopeKey: 'lineup:-1-2-3-4-5-' }; // WRONGLY stamped
    expect(shouldPlayExit(was, null, 'lineup:-1-2-3-4-5-', true)).toBe(true);
    // With the outgoing connection's REAL scope, the guard correctly refuses.
    const correct = { connection: CONN, scopeKey: 'team:team' };
    expect(shouldPlayExit(correct, null, 'lineup:-1-2-3-4-5-', true)).toBe(false);
  });

  it('does not play under reduced motion', () => {
    expect(shouldPlayExit({ connection: CONN, scopeKey: 'team:team' }, null, 'team:team', false))
      .toBe(false);
  });

  it('does not play when a connection is merely replaced by another', () => {
    // Selecting a different arc is not an exit — the court swaps content in place.
    expect(
      shouldPlayExit({ connection: CONN, scopeKey: 'team:team' }, { assisterId: 3, shooterId: 4 }, 'team:team', true),
    ).toBe(false);
  });
});
