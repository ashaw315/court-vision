import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

import { getSeasonScope, getTeamGrain } from '@/lib/api/queries';
import { methodologyFootnote, seasonScope } from '@/lib/data/scope';
import {
  collapsePanel,
  initialPanelState,
  onSelectionChange,
  openPanel,
} from '@/lib/panel/state';

/**
 * The reading guide: choreography, and the honesty of what it asserts.
 *
 * The panel is mostly prose, which makes it the easiest place in the project to introduce a
 * false claim — the label audits all began with a sentence that was true somewhere else.
 * These tests pin the numbers to real data and pin the prose against claims the running app
 * contradicts.
 */

const source = () =>
  readFile(new URL('../src/components/InfoPanel.tsx', import.meta.url), 'utf8');

describe('open / collapse choreography', () => {
  it('is open at rest', () => {
    expect(initialPanelState.open).toBe(true);
  });

  it('collapses when a connection summons the court', () => {
    const next = onSelectionChange(initialPanelState, false, true);
    expect(next.open).toBe(false);
  });

  it('reopens when the connection is cleared', () => {
    const collapsed = onSelectionChange(initialPanelState, false, true);
    expect(onSelectionChange(collapsed, true, false).open).toBe(true);
  });

  it('reopens on demand while a connection is showing', () => {
    const collapsed = onSelectionChange(initialPanelState, false, true);
    expect(openPanel(collapsed, true).open).toBe(true);
  });

  it('does not slam shut again when the reader picks another connection', () => {
    // Selecting a second connection must not undo a deliberate reopen — the auto-collapse
    // fires on entering a selection, not on every selection change.
    const reopened = openPanel(onSelectionChange(initialPanelState, false, true), true);
    expect(onSelectionChange(reopened, true, true).open).toBe(true);
  });

  it('only collapses on the TRANSITION into a selection', () => {
    // The guard above is shielded by `userOverride`, so it cannot see a policy that
    // collapses on every change. This case has no override: a panel already open while a
    // connection is showing must survive a switch to another connection.
    const openDuringSelection = { open: true, userOverride: false };
    expect(onSelectionChange(openDuringSelection, true, true))
      .toEqual(openDuringSelection);
  });

  it('collapses by hand and stays collapsed', () => {
    expect(collapsePanel(initialPanelState).open).toBe(false);
  });

  it('forgets the override once the court is dismissed', () => {
    const reopened = openPanel(onSelectionChange(initialPanelState, false, true), true);
    const cleared = onSelectionChange(reopened, true, false);
    expect(cleared).toEqual(initialPanelState);
    // A fresh selection then collapses again, as at rest.
    expect(onSelectionChange(cleared, false, true).open).toBe(false);
  });
});

describe('motion respects the reader', () => {
  it('drives the panel animation from the same flag as the plates', async () => {
    // `animate` is false under prefers-reduced-motion, so the guide appears instantly.
    const instrument = await readFile(
      new URL('../src/components/Instrument.tsx', import.meta.url), 'utf8',
    );
    expect(instrument).toMatch(/animation: animate\s*\n?\s*\?\s*`cv-slide-in/);
  });
});

describe('methodology numbers come from real data', () => {
  let preflightError: string | null = null;
  let scope: Awaited<ReturnType<typeof getSeasonScope>> | null = null;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      preflightError = 'DATABASE_URL is not set — this test reads the seeded database.';
      return;
    }
    try {
      scope = await getSeasonScope();
    } catch (error) {
      preflightError = `Could not reach the database: ${(error as Error).message}`;
    }
  });

  it('has a seeded database to read', () => {
    expect(preflightError).toBeNull();
  });

  it('renders the game counts from the scope, never as literals', async () => {
    const text = await source();
    // The panel must interpolate; a hardcoded 72/82/10 would silently rot if the dataset
    // were regenerated.
    expect(text).toContain('{scope.games} of {scope.scheduledGames} games');
    expect(text).toContain('{scope.excludedGames} were excluded');
    expect(text).not.toMatch(/\b72 of 82\b/);
  });

  it('matches the footnote the plates already print', () => {
    // Same source of truth, so panel and footnote cannot disagree.
    expect(scope).not.toBeNull();
    const footnote = methodologyFootnote(scope!);
    expect(footnote).toContain(`${scope!.games} of ${scope!.scheduledGames} games`);
    expect(footnote).toContain(`${scope!.excludedGames} games excluded`);
  });

  it('omits the exclusion paragraph when nothing was excluded', async () => {
    // A regenerated dataset with all games valid must not print "0 were excluded".
    const clean = seasonScope(82, 82);
    expect(clean.excludedGames).toBe(0);
    expect(await source()).toContain('scope.excludedGames > 0 &&');
  });

  it('takes the season label from config', async () => {
    expect(await source()).toContain('{scope.season} ${scope.seasonType.toLowerCase()}'.replace('${', '${'));
  });
});

describe('the prose does not assert anything the app contradicts', () => {
  it('does not claim the court omits a per-connection game count', async () => {
    // The court DOES show one (36 games for Claxton -> Porter Jr.), and it is correct.
    // Claiming otherwise would be a fresh false statement of exactly the audited class.
    const text = await source();
    expect(text).not.toMatch(/no per-connection game count/i);
    expect(text).not.toMatch(/season scope only/i);
  });

  it('does not imply unresolved assisters exist in this dataset', async () => {
    // Policy is real ("recorded as unknown rather than guessed"); the COUNT is zero, so the
    // panel must not suggest missing edges the reader could go looking for.
    const team = await getTeamGrain();
    expect(team.split.unresolvedAssisted).toBe(0);
    const text = await source();
    expect(text).toContain('rather than guessed');
    expect(text).not.toMatch(/some assisters could not be resolved/i);
  });

  it('describes the node fill with the disambiguated wording', async () => {
    // Matches the §C phrasing the label audit settled on.
    const text = await source();
    expect(text).toContain('Scores X% off teammates');
    expect(text).toContain('X% of assisted creation');
  });

  it('states the player-grain node-fill caveat only in the player grain', async () => {
    const text = await source();
    expect(text).toContain("grain === 'player'");
    expect(text).toContain('not measurable here');
  });

  it('claims box-score reconciliation, which the dataset supports', async () => {
    // Verified in Phase 3: shots, assists and minutes matched the official box scores.
    const text = await source();
    expect(text).toContain('reconcile to the official box scores');
    const team = await getTeamGrain();
    expect(team.split.madeBaskets).toBe(team.split.assisted + team.split.selfCreated);
  });
});



describe('§III capping copy is true in every grain', () => {
  /** The panel's own rule, mirrored: thinned scopes describe the cap, uncapped ones don't. */
  const describesCap = (note: { thinned: boolean }) => note.thinned;

  it('claims a cap exactly when the plate actually caps', async () => {
    // The failure this guards: a blanket "the plate shows the most-involved players" is
    // FALSE in lineup grain, where all five players and every connection are drawn.
    const { getTeamGrain, getLineup, getLineupGrain, getPlayerGrain } =
      await import('@/lib/api/queries');
    const { DENSITY, scopeForPlate } = await import('@/lib/network/density');

    const row = await getLineup('-1629008-1629611-1629651-1641730-1642856-');
    const cases: Array<[string, boolean]> = [];
    for (const raw of [
      await getTeamGrain(),
      await getLineupGrain(row!),
      await getPlayerGrain(1629008, 'Porter Jr.'),
    ]) {
      const { note } = scopeForPlate(raw, DENSITY[raw.scope.grain]);
      cases.push([raw.scope.grain, describesCap(note)]);
    }

    expect(cases).toEqual([
      ['team', true],    // 8 of 22 players, 18 of 286 connections
      ['lineup', false], // 5 players, all 20 connections — nothing withheld
      ['player', true],  // 10 of 14 players, 18 of 26 connections
    ]);
  });

  it('renders the cap sentence from the note, not from literals', async () => {
    const text = await source();
    // Numbers must interpolate, or the copy would rot the moment a cap changed.
    expect(text).toContain('{density.shownPlayers} most-involved of');
    expect(text).toContain('{density.totalPlayers} players');
    expect(text).toContain('{density.shownConnections} highest-share');
    expect(text).toContain('{density.totalConnections} connections');
    expect(text).not.toMatch(/\b8 most-involved of 22\b/);
  });

  it('offers an uncapped branch that claims nothing is withheld', async () => {
    const text = await source();
    expect(text).toContain('density?.thinned ?');
    expect(text).toContain('Every player and every connection in this view is drawn');
  });

  it('frames the cap as a display choice, not missing data', async () => {
    const text = await source();
    expect(text).toContain('display choice, not a limit');
  });
});
