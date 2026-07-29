import { describe, expect, it } from 'vitest';

import {
  AssistEdge,
  Lineup,
  LineupInterval,
  Player,
  ScopeFilter,
  ShotEvent,
} from '@/lib/contracts';

/**
 * Phase 2 tests cover the CONTRACT only: does a valid shape parse, and does an
 * invalid one fail? The parsers that produce these shapes from raw endpoint data —
 * description-text assist resolution, substitution-to-interval derivation — are
 * Phase 3 and are tested there against the saved fixtures.
 *
 * The valid fixtures below are transcribed from real spike output
 * (spike_out/s2b_pbp_v3_sample.json, s2b_JOINED.json, q3_lineups.json) rather than
 * invented, so the schemas are checked against the shapes they will actually meet.
 */

/** Real V3 event: Porter Jr.'s missed 26' three, actionNumber 7. */
const missedShot: ShotEvent = {
  gameId: '0022500123',
  eventId: 7,
  period: 1,
  clock: 'PT11M41.00S',
  shooterId: 1629008,
  locX: -136,
  locY: 216,
  shotValue: 3,
  made: false,
  assisted: false,
  assisterId: null,
  shotDistance: 26,
  actionType: 'Missed Shot',
  subType: 'Jump Shot',
  teamId: 1610612751,
  intervalId: '0022500123:1610612751:1:PT12M00.00S',
};

/** Real joined event: "Powell 25' 3PT Jump Shot (3 PTS) (Mann 1 AST)", event 10. */
const assistedShot: ShotEvent = {
  gameId: '0022500123',
  eventId: 10,
  period: 1,
  clock: 'PT10M58.00S',
  shooterId: 1642268, // Drake Powell
  locX: 49,
  locY: 246,
  shotValue: 3,
  made: true,
  assisted: true,
  assisterId: 1629611, // Terance Mann
  shotDistance: 25,
  actionType: 'Made Shot',
  subType: 'Jump Shot',
  teamId: 1610612751,
  intervalId: '0022500123:1610612751:1:PT12M00.00S',
};

describe('ShotEvent', () => {
  it('parses a real missed shot', () => {
    expect(ShotEvent.parse(missedShot)).toEqual(missedShot);
  });

  it('parses a real assisted make', () => {
    expect(ShotEvent.parse(assistedShot)).toEqual(assistedShot);
  });

  it('parses an unassisted make with a null assisterId', () => {
    // "Mann 2' Driving Layup (2 PTS)" — a real make with no AST tag.
    const unassisted = {
      ...assistedShot,
      eventId: 72,
      shooterId: 1629611,
      assisted: false,
      assisterId: null,
      shotValue: 2 as const,
    };
    expect(ShotEvent.parse(unassisted).assisterId).toBeNull();
  });

  it('rejects a missing shooterId', () => {
    const { shooterId: _omitted, ...noShooter } = assistedShot;
    expect(ShotEvent.safeParse(noShooter).success).toBe(false);
  });

  it('rejects a shotValue outside {2, 3}', () => {
    // Free throws are not field goals and must never enter as ShotEvents.
    expect(ShotEvent.safeParse({ ...assistedShot, shotValue: 1 }).success).toBe(false);
    expect(ShotEvent.safeParse({ ...assistedShot, shotValue: 4 }).success).toBe(false);
  });

  it('rejects a name in place of a personId', () => {
    // Guards the join-key rule: identity is numeric, never a name.
    expect(ShotEvent.safeParse({ ...assistedShot, shooterId: 'Powell' }).success).toBe(false);
  });

  it('rejects a malformed clock', () => {
    expect(ShotEvent.safeParse({ ...assistedShot, clock: '11:41' }).success).toBe(false);
  });

  it('rejects an assisted miss', () => {
    const contradiction = { ...assistedShot, made: false };
    expect(ShotEvent.safeParse(contradiction).success).toBe(false);
  });

  it('rejects an assisterId on an unassisted shot', () => {
    const contradiction = { ...assistedShot, assisted: false };
    expect(ShotEvent.safeParse(contradiction).success).toBe(false);
  });

  it('rejects a player assisting their own shot', () => {
    const selfAssist = { ...assistedShot, assisterId: assistedShot.shooterId };
    expect(ShotEvent.safeParse(selfAssist).success).toBe(false);
  });

  it('preserves intervalId — the lineup attribution must survive parsing', () => {
    // Zod strips undeclared keys silently, so a field the schema does not know about
    // would vanish here without any error. That would quietly remove the
    // lineup-filtered assist capability on the way from the ETL into the app.
    const parsed = ShotEvent.parse(assistedShot);
    expect(parsed.intervalId).toBe('0022500123:1610612751:1:PT12M00.00S');
  });

  it('accepts a null intervalId as explicitly unattributable', () => {
    // Null means the on-court five could not be established for this moment — honest
    // incompleteness. A wrong intervalId would be a fabricated claim about a unit.
    const parsed = ShotEvent.parse({ ...assistedShot, intervalId: null });
    expect(parsed.intervalId).toBeNull();
  });

  it('rejects an empty-string intervalId', () => {
    expect(ShotEvent.safeParse({ ...assistedShot, intervalId: '' }).success).toBe(false);
  });

  it('requires a teamId so aggregates can be scoped to one side', () => {
    const { teamId: _omitted, ...noTeam } = assistedShot;
    expect(ShotEvent.safeParse(noTeam).success).toBe(false);
  });
});

describe('AssistEdge', () => {
  const edge: AssistEdge = {
    assisterId: 1629611,
    shooterId: 1642268,
    count: 3,
    points: 8,
    made2: 1,
    made3: 2,
  };

  it('parses a consistent edge', () => {
    expect(AssistEdge.parse(edge)).toEqual(edge);
  });

  it('rejects a count that disagrees with made2 + made3', () => {
    expect(AssistEdge.safeParse({ ...edge, count: 5 }).success).toBe(false);
  });

  it('rejects points that disagree with the 2s/3s breakdown', () => {
    expect(AssistEdge.safeParse({ ...edge, points: 99 }).success).toBe(false);
  });

  it('rejects a self-directed edge', () => {
    expect(AssistEdge.safeParse({ ...edge, shooterId: edge.assisterId }).success).toBe(false);
  });
});

describe('Lineup', () => {
  /** The real top Nets unit from q3_lineups.json (~307 minutes). */
  const lineup: Lineup = {
    groupId: '-1629008-1629611-1629651-1641730-1642856-',
    personIds: [1629008, 1629611, 1629651, 1641730, 1642856],
    minutes: 306.983333,
    displayNames: ['M. Porter Jr.', 'T. Mann', 'N. Claxton', 'N. Clowney', 'E. Dëmin'],
  };

  it('parses the real top unit', () => {
    expect(Lineup.parse(lineup)).toEqual(lineup);
  });

  it('rejects a groupId that is not the dash-delimited id form', () => {
    const displayName = 'M. Porter Jr. - T. Mann - N. Claxton - N. Clowney - E. Dëmin';
    expect(Lineup.safeParse({ ...lineup, groupId: displayName }).success).toBe(false);
  });

  it('rejects unsorted personIds', () => {
    const unsorted = [1629611, 1629008, 1629651, 1641730, 1642856];
    expect(Lineup.safeParse({ ...lineup, personIds: unsorted }).success).toBe(false);
  });

  it('rejects a unit that is not five players', () => {
    expect(Lineup.safeParse({ ...lineup, personIds: [1629008, 1629611] }).success).toBe(false);
  });

  it('rejects duplicate players in a unit', () => {
    const dupe = [1629008, 1629008, 1629651, 1641730, 1642856];
    expect(Lineup.safeParse({ ...lineup, personIds: dupe }).success).toBe(false);
  });
});

describe('LineupInterval', () => {
  const interval: LineupInterval = {
    gameId: '0022500123',
    intervalId: '0022500123:1:PT12M00.00S',
    period: 1,
    startClock: 'PT12M00.00S',
    endClock: 'PT06M04.00S',
    onCourt: [1629008, 1629611, 1629651, 1641730, 1642856],
  };

  it('parses an interval derived from a substitution boundary', () => {
    expect(LineupInterval.parse(interval)).toEqual(interval);
  });

  it('rejects an on-court set that is not five distinct players', () => {
    const four = [1629008, 1629611, 1629651, 1641730];
    expect(LineupInterval.safeParse({ ...interval, onCourt: four }).success).toBe(false);
  });
});

describe('Player', () => {
  it('parses a player', () => {
    const player: Player = { personId: 1629008, displayName: 'M. Porter Jr.' };
    expect(Player.parse(player)).toEqual(player);
  });

  it('rejects a non-numeric personId', () => {
    expect(Player.safeParse({ personId: '1629008', displayName: 'M. Porter Jr.' }).success)
      .toBe(false);
  });
});

describe('ScopeFilter', () => {
  it('accepts an empty filter (the full loaded season)', () => {
    expect(ScopeFilter.parse({})).toEqual({});
  });

  it('accepts a single-game scope', () => {
    expect(ScopeFilter.parse({ gameId: '0022500123' }).gameId).toBe('0022500123');
  });

  it('rejects a malformed date', () => {
    expect(ScopeFilter.safeParse({ dateFrom: '11/04/2025' }).success).toBe(false);
  });
});
