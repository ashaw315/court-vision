import { describe, expect, it } from 'vitest';

import { NETS_TEAM_ID, TEAMS, teamByAbbreviation, teamById } from '@/lib/teams';

describe('TEAMS', () => {
  it('lists 30 franchises with unique ids and abbreviations', () => {
    expect(TEAMS).toHaveLength(30);
    expect(new Set(TEAMS.map((t) => t.teamId)).size).toBe(30);
    expect(new Set(TEAMS.map((t) => t.abbreviation)).size).toBe(30);
  });

  it('has six divisions of five, fifteen teams per conference', () => {
    const divisions = new Map<string, number>();
    for (const t of TEAMS) divisions.set(`${t.conference}|${t.division}`, (divisions.get(`${t.conference}|${t.division}`) ?? 0) + 1);
    expect(divisions.size).toBe(6);
    expect([...divisions.values()].every((n) => n === 5)).toBe(true);
  });

  it('resolves by id and case-insensitively by abbreviation', () => {
    expect(teamById(NETS_TEAM_ID)?.abbreviation).toBe('BKN');
    expect(teamByAbbreviation('bkn')?.teamId).toBe(NETS_TEAM_ID);
    expect(teamByAbbreviation('XXX')).toBeUndefined();
  });
});
