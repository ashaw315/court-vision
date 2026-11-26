import type { SideLine } from '@/lib/contracts/analysis';

export const fmt = (n: number, digits = 1) => n.toFixed(digits);
export const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—');
export const signed = (n: number, digits = 1) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}`;

/** Points per shot; null when there were no shots. */
export const pointsPerShot = (l: SideLine) => (l.shots > 0 ? l.points / l.shots : null);
export const expectedPerShot = (l: SideLine) => (l.shots > 0 ? l.expectedPoints / l.shots : null);
export const threeRate = (l: SideLine) => (l.shots > 0 ? l.threes / l.shots : null);
export const assistedShare = (l: SideLine) => (l.made > 0 ? l.madeAssisted / l.made : null);

/**
 * The data-audit cell: which checks a game failed, by name. The verifier's full detail
 * stays in the database; it is long and full of unbreakable ids, so the page shows names.
 */
export function auditChecks(reasons: string[]): string {
  const names = reasons.map((r) => r
    .replace(/^(check failed|problem): /, '')
    .replace(/ \([\s\S]*$/, '')
    .trim());
  return [...new Set(names)].join('; ');
}
