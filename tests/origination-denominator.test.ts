import { describe, expect, it } from 'vitest';

import { getTeamGrain } from '@/lib/api/queries';
import { DENSITY, scopeForPlate } from '@/lib/network/density';
import { buildOrigination, buildRoleNodes } from '@/lib/network/model';

/**
 * §D origination denominator.
 *
 * The team plate draws the 8 most-involved of 22 players. Computing each bar against the
 * DRAWN total made the bars renormalise to ~100%, implying the eight names were the whole
 * roster's creation. That is the same flattering-denominator error as the Stage 5 "100% of
 * assisted creation" caption: technically consistent within the subgraph, misleading about
 * the season.
 *
 * The bars must state the share of the FULL scope, so they sum to the coverage the density
 * note reports (~31%) rather than to 100%.
 */

describe('team origination bars use the whole-scope denominator', () => {
  it('does not renormalise the shown players to 100%', async () => {
    const team = await getTeamGrain();
    const { data, note } = scopeForPlate(team, DENSITY.team);
    const rows = buildOrigination(buildRoleNodes(data), team);

    const sum = rows.reduce((total, row) => total + row.share, 0);
    // Renormalised bars summed to exactly 100 and overstated every player.
    expect(sum).toBeLessThan(99);

    // The bars sum to ALL creation originated by the shown players — including their edges
    // to teammates the plate does not draw — so this is legitimately higher than the
    // density note's figure, which counts only the drawn edges. Both are honest; they
    // answer different questions. What matters is that neither is 100%.
    expect(sum).toBeGreaterThan(note.coverageOfScope);

    const wholeTotal = team.edges.reduce((total, edge) => total + edge.count, 0);
    const byShown = team.edges
      .filter((edge) => data.players.some((p) => p.personId === edge.assisterId))
      .reduce((total, edge) => total + edge.count, 0);
    expect(sum).toBeCloseTo((byShown / wholeTotal) * 100, 6);
  });

  it('reports each bar against the full scope, not the subgraph', async () => {
    const team = await getTeamGrain();
    const { data } = scopeForPlate(team, DENSITY.team);
    const rows = buildOrigination(buildRoleNodes(data), team);

    const wholeTotal = team.edges.reduce((sum, edge) => sum + edge.count, 0);
    for (const row of rows) {
      const originated = team.edges
        .filter((edge) => edge.assisterId === row.personId)
        .reduce((sum, edge) => sum + edge.count, 0);
      expect(row.share).toBeCloseTo((originated / wholeTotal) * 100, 6);
    }
  });

  it('keeps the label consistent with the share it renders', async () => {
    const team = await getTeamGrain();
    const { data } = scopeForPlate(team, DENSITY.team);
    for (const row of buildOrigination(buildRoleNodes(data), team)) {
      expect(row.label).toBe(`${Math.round(row.share * 10) / 10}%`);
    }
  });

  it('is unchanged for an uncapped scope', async () => {
    // A lineup is never thinned, so full-scope and drawn-scope denominators coincide and
    // the bars must still sum to 100%.
    const team = await getTeamGrain();
    const { data } = scopeForPlate(team, DENSITY.team);
    const rowsAgainstSelf = buildOrigination(buildRoleNodes(data), data);
    const sum = rowsAgainstSelf.reduce((total, row) => total + row.share, 0);
    expect(sum).toBeCloseTo(100, 6);
  });
});
