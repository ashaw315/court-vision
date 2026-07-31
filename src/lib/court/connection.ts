import type { GrainResponse, ShotEvent } from '@/lib/contracts';
import { formatShare } from '@/lib/network/model';

import {
  classifyShot,
  isInsideCrop,
  shotSide,
  shotToCourt,
  tallyShots,
  type ShotTally,
} from './geometry';

/**
 * Selecting and describing ONE creation connection for the Spatial Signature plate.
 *
 * Pure functions over the contract, so the spatial reading is testable without a court,
 * a browser or a database.
 */

export type ConnectionShots = {
  assisterId: number;
  shooterId: number;
  assisterName: string;
  shooterName: string;
  /**
   * The made baskets this connection produced, at their real court locations — ONLY those
   * that can actually be drawn inside the 40 ft crop. The plate's marks, its caption count,
   * its tally and its §F reading all derive from this one list, so they cannot disagree.
   */
  shots: ShotEvent[];
  /**
   * Made baskets excluded because they fall outside the crop. Kept as a count so the plate
   * can disclose them ("2 baskets beyond 40 ft, not shown") rather than dropping them
   * silently — the number must stay nameable even though it cannot be plotted.
   */
  clipped: number;
  /** Share of the unit's total assisted creation, 0–100. */
  share: number;
  tally: ShotTally;
};

/**
 * Pull one connection's made baskets out of a grain response.
 *
 * The filter is deliberately strict — made AND tagged assisted AND assister matches. That
 * mirrors how the network plate counts the same connection, which is why the two plates
 * agree on the basket count (asserted in the tests).
 */
export function selectConnection(
  data: GrainResponse,
  assisterId: number,
  shooterId: number,
): ConnectionShots | null {
  const names = new Map(data.players.map((p) => [p.personId, p.displayName]));
  if (!names.has(assisterId) || !names.has(shooterId)) return null;

  const matching = data.shots.filter(
    (shot) =>
      shot.made
      && shot.assisted
      && shot.assisterId === assisterId
      && shot.shooterId === shooterId,
  );

  // The crop decision happens HERE, once. Previously the component filtered for plotting
  // while the tally and reading used the unfiltered list, so a make beyond 40 ft would
  // plot 7 marks under a caption reading 8 baskets. No such shot exists in the season yet,
  // which is exactly why it needed pinning rather than leaving to luck.
  const shots = matching.filter((shot) => isInsideCrop(shotToCourt(shot.locX, shot.locY)));
  const clipped = matching.length - shots.length;

  const totalAssisted = data.edges.reduce((sum, edge) => sum + edge.count, 0);
  const edge = data.edges.find(
    (candidate) => candidate.assisterId === assisterId && candidate.shooterId === shooterId,
  );

  return {
    assisterId,
    shooterId,
    assisterName: names.get(assisterId)!,
    shooterName: names.get(shooterId)!,
    shots,
    clipped,
    share: totalAssisted && edge ? (edge.count / totalAssisted) * 100 : 0,
    tally: tallyShots(shots),
  };
}

/** The unit's single biggest connection — what the plate shows by default. */
export function biggestConnection(data: GrainResponse): ConnectionShots | null {
  const top = [...data.edges].sort((a, b) => b.count - a.count)[0];
  if (!top) return null;
  return selectConnection(data, top.assisterId, top.shooterId);
}

/**
 * The §F / READING annotation — a plain-language spatial insight computed from the shots.
 *
 * Describes what the marks actually show: where the baskets land, and where the threes
 * come from. Wording adapts to the data, so a rim connection and a perimeter connection
 * read differently rather than sharing one hedged sentence.
 */
export function buildSpatialReading(connection: ConnectionShots): string {
  const { shots, tally, assisterName, shooterName } = connection;
  if (shots.length === 0) {
    return `No made baskets recorded for ${assisterName} to ${shooterName}.`;
  }

  const inside = tally.rim + tally.mid;
  const insideShare = inside / tally.total;

  // Lead with the connection's dominant character.
  let opening: string;
  if (tally.rim / tally.total >= 0.5) {
    opening = 'This is a rim connection';
  } else if (tally.three / tally.total >= 0.5) {
    opening = 'This is a perimeter connection';
  } else if (insideShare >= 0.6) {
    opening = 'This connection works mostly inside the arc';
  } else {
    opening = 'This connection is spread across the floor';
  }

  const sentences: string[] = [];
  sentences.push(
    `${opening}: ${describeFraction(inside, tally.total)} of its ${tally.total} `
      + `made ${tally.total === 1 ? 'basket' : 'baskets'} land inside the arc.`,
  );

  // Where do the threes come from? Only worth saying if there are any.
  if (tally.three > 0) {
    const threes = shots.filter((shot) => classifyShot(shot) === 'three');
    const sides = new Map<string, number>();
    for (const shot of threes) {
      const side = shotSide(shot.locX);
      sides.set(side, (sides.get(side) ?? 0) + 1);
    }
    const ranked = [...sides.entries()].sort((a, b) => b[1] - a[1]);
    const dominant = ranked[0];
    const spread = ranked.length > 1 && ranked[0][1] === ranked[1][1];

    if (spread) {
      sentences.push(
        `The ${tally.three} ${tally.three === 1 ? 'three' : 'threes'} come from both sides.`,
      );
    } else {
      const where = dominant[0] === 'middle' ? 'straight on' : `the ${dominant[0]} side`;
      sentences.push(
        `The ${tally.three} ${tally.three === 1 ? 'three' : 'threes'} come mostly from ${where}.`,
      );
    }
  } else {
    sentences.push('It produces no threes at all.');
  }

  sentences.push(
    `${formatShare(Math.round(connection.share * 10) / 10)} of the unit's assisted creation, `
      + `${tally.points} points in all.`,
  );

  return sentences.join(' ');
}

/** "Two thirds", "half", "all" — plain language beats a bare ratio in prose. */
function describeFraction(part: number, whole: number): string {
  if (whole === 0) return 'none';
  if (part === whole) return 'all';
  if (part === 0) return 'none';
  const ratio = part / whole;
  if (Math.abs(ratio - 0.5) < 0.06) return 'half';
  if (Math.abs(ratio - 2 / 3) < 0.06) return 'two thirds';
  if (Math.abs(ratio - 1 / 3) < 0.06) return 'a third';
  if (Math.abs(ratio - 0.75) < 0.06) return 'three quarters';
  if (Math.abs(ratio - 0.25) < 0.06) return 'a quarter';
  return `${Math.round(ratio * 100)}%`;
}
