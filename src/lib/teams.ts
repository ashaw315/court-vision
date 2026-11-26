/**
 * The 30 NBA franchises, keyed by the NBA's own team id.
 *
 * Mirrors the `teams` table that migration 0001 seeds; `tests/teams.test.ts` checks this
 * list is internally consistent (30 unique teams, 6 divisions of 5). It lives in code as well as the database because the team picker,
 * the matchup parser and the URL router all need it without a query.
 */
export type Conference = 'East' | 'West';

export interface Team {
  readonly teamId: number;
  readonly abbreviation: string;
  readonly city: string;
  readonly name: string;
  readonly conference: Conference;
  readonly division: string;
}

export const TEAMS: readonly Team[] = [
  { teamId: 1610612737, abbreviation: 'ATL', city: 'Atlanta', name: 'Hawks', conference: 'East', division: 'Southeast' },
  { teamId: 1610612751, abbreviation: 'BKN', city: 'Brooklyn', name: 'Nets', conference: 'East', division: 'Atlantic' },
  { teamId: 1610612738, abbreviation: 'BOS', city: 'Boston', name: 'Celtics', conference: 'East', division: 'Atlantic' },
  { teamId: 1610612766, abbreviation: 'CHA', city: 'Charlotte', name: 'Hornets', conference: 'East', division: 'Southeast' },
  { teamId: 1610612741, abbreviation: 'CHI', city: 'Chicago', name: 'Bulls', conference: 'East', division: 'Central' },
  { teamId: 1610612739, abbreviation: 'CLE', city: 'Cleveland', name: 'Cavaliers', conference: 'East', division: 'Central' },
  { teamId: 1610612742, abbreviation: 'DAL', city: 'Dallas', name: 'Mavericks', conference: 'West', division: 'Southwest' },
  { teamId: 1610612743, abbreviation: 'DEN', city: 'Denver', name: 'Nuggets', conference: 'West', division: 'Northwest' },
  { teamId: 1610612765, abbreviation: 'DET', city: 'Detroit', name: 'Pistons', conference: 'East', division: 'Central' },
  { teamId: 1610612744, abbreviation: 'GSW', city: 'San Francisco', name: 'Warriors', conference: 'West', division: 'Pacific' },
  { teamId: 1610612745, abbreviation: 'HOU', city: 'Houston', name: 'Rockets', conference: 'West', division: 'Southwest' },
  { teamId: 1610612754, abbreviation: 'IND', city: 'Indiana', name: 'Pacers', conference: 'East', division: 'Central' },
  { teamId: 1610612746, abbreviation: 'LAC', city: 'Los Angeles', name: 'Clippers', conference: 'West', division: 'Pacific' },
  { teamId: 1610612747, abbreviation: 'LAL', city: 'Los Angeles', name: 'Lakers', conference: 'West', division: 'Pacific' },
  { teamId: 1610612763, abbreviation: 'MEM', city: 'Memphis', name: 'Grizzlies', conference: 'West', division: 'Southwest' },
  { teamId: 1610612748, abbreviation: 'MIA', city: 'Miami', name: 'Heat', conference: 'East', division: 'Southeast' },
  { teamId: 1610612749, abbreviation: 'MIL', city: 'Milwaukee', name: 'Bucks', conference: 'East', division: 'Central' },
  { teamId: 1610612750, abbreviation: 'MIN', city: 'Minnesota', name: 'Timberwolves', conference: 'West', division: 'Northwest' },
  { teamId: 1610612740, abbreviation: 'NOP', city: 'New Orleans', name: 'Pelicans', conference: 'West', division: 'Southwest' },
  { teamId: 1610612752, abbreviation: 'NYK', city: 'New York', name: 'Knicks', conference: 'East', division: 'Atlantic' },
  { teamId: 1610612760, abbreviation: 'OKC', city: 'Oklahoma City', name: 'Thunder', conference: 'West', division: 'Northwest' },
  { teamId: 1610612753, abbreviation: 'ORL', city: 'Orlando', name: 'Magic', conference: 'East', division: 'Southeast' },
  { teamId: 1610612755, abbreviation: 'PHI', city: 'Philadelphia', name: '76ers', conference: 'East', division: 'Atlantic' },
  { teamId: 1610612756, abbreviation: 'PHX', city: 'Phoenix', name: 'Suns', conference: 'West', division: 'Pacific' },
  { teamId: 1610612757, abbreviation: 'POR', city: 'Portland', name: 'Trail Blazers', conference: 'West', division: 'Northwest' },
  { teamId: 1610612758, abbreviation: 'SAC', city: 'Sacramento', name: 'Kings', conference: 'West', division: 'Pacific' },
  { teamId: 1610612759, abbreviation: 'SAS', city: 'San Antonio', name: 'Spurs', conference: 'West', division: 'Southwest' },
  { teamId: 1610612761, abbreviation: 'TOR', city: 'Toronto', name: 'Raptors', conference: 'East', division: 'Atlantic' },
  { teamId: 1610612762, abbreviation: 'UTA', city: 'Utah', name: 'Jazz', conference: 'West', division: 'Northwest' },
  { teamId: 1610612764, abbreviation: 'WAS', city: 'Washington', name: 'Wizards', conference: 'East', division: 'Southeast' },
] as const;

const BY_ID = new Map(TEAMS.map((team) => [team.teamId, team]));
const BY_ABBREVIATION = new Map(TEAMS.map((team) => [team.abbreviation, team]));

export const NETS_TEAM_ID = 1610612751;

export function teamById(teamId: number): Team | undefined {
  return BY_ID.get(teamId);
}

/** Case-insensitive, so `/2025-26/bkn` and `BKN` both resolve. */
export function teamByAbbreviation(abbreviation: string): Team | undefined {
  return BY_ABBREVIATION.get(abbreviation.toUpperCase());
}

export function teamLabel(team: Team): string {
  return `${team.city} ${team.name}`;
}
