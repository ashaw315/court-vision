import { describe, expect, it } from 'vitest';

import { auditChecks } from '@/components/analysis/format';

/**
 * db:load stores each failed check with the verifier's full detail (interval ids, clock
 * strings) — the audit trail. The data-audit table shows only which checks failed; the long
 * detail has unbreakable tokens that overflow a phone screen.
 */
describe('auditChecks', () => {
  it('reduces verifier output to check names', () => {
    expect(auditChecks([
      'check failed: intervals tile each period contiguously (period 1 0022500128:1610612738:1:PT00M04.20S: clock runs backwards)',
      'check failed: the shooter is on court for their own shot (2 shots; first few [(723, 1630573, (1627759,))])',
    ])).toBe('intervals tile each period contiguously; the shooter is on court for their own shot');
  });

  it('keeps already-short names (the seeded sample) as they are', () => {
    expect(auditChecks(['shot attribution coverage'])).toBe('shot attribution coverage');
  });

  it('names a non-check problem and drops duplicates', () => {
    expect(auditChecks(['problem: minutes reconciliation skipped', 'check failed: a (x)', 'check failed: a (y)']))
      .toBe('minutes reconciliation skipped; a');
  });

  it('keeps a fetch error readable', () => {
    expect(auditChecks(['fetch error: ReadTimeout: timed out (30s)'])).toBe('fetch error: ReadTimeout: timed out');
  });
});
