import type { GrainResponse } from '@/lib/contracts';

/**
 * Density control for scopes larger than the plate was designed for.
 *
 * The plate is a five-node instrument. The team grain is 22 players and 286 connections,
 * and drawing all of it is not a plate — it is a knot. So the team view is thinned before
 * it reaches the renderer.
 *
 * The honesty problem this creates, and how it is handled:
 *
 *   Capping edges alone is misleading. On the real team the top 18 of 286 connections
 *   carry only 31% of the assisted creation, so a plate showing "the top 18" would hide
 *   more than two thirds of how the Nets actually create while looking complete.
 *
 *   Thresholding NODES first is much better value. The ten most-involved players account
 *   for 60% of all creation between them; the eight most involved leave a subgraph whose
 *   top 18 channels carry 64% OF THAT SUBGRAPH. That is a defensible "here is the
 *   rotation's creation structure", and it is a claim about a stated subset rather than a
 *   silent truncation of everything.
 *
 * So both figures travel with the result and the plate states them. What is dropped is
 * always named — the tool never implies it is showing everything.
 */

export type DensityLimits = {
  /** Keep only the N most-involved players. null = keep all. */
  maxNodes: number | null;
  /** Then keep only the N largest connections among them. null = keep all. */
  maxConnections: number | null;
};

/**
 * Per-grain limits.
 *
 * Only the LINEUP grain is genuinely small — five players by definition, which is the plate
 * as designed. Team and player are both wide and both need thinning.
 *
 * Player needing a cap was not obvious and was measured, not assumed: a player's scope
 * includes every teammate they have ever assisted or been assisted by, which across a
 * season is 13–21 people. Rendered uncapped that collapses into a single horizontal band
 * of overprinting labels — denser on screen than the team plate it was supposed to be
 * smaller than. Most of those nodes are near-empty: for Porter Jr., 13 of 14 teammates
 * have NO MADE BASKETS in his scope, so the crowding buys almost no information.
 */
export const DENSITY: Record<'team' | 'lineup' | 'player', DensityLimits> = {
  // Eight nodes fills the role-space columns without collisions, and keeps the retained
  // channels a majority of their own subgraph rather than a thin slice of everything.
  team: { maxNodes: 8, maxConnections: 18 },
  // A five-man unit IS the resolved design. Capping it would restyle the plate for nothing.
  lineup: { maxNodes: null, maxConnections: null },
  // Ten keeps the worst-case player (Wilson) at ~65% of their own creation while matching
  // the team plate's legible density. Eight would thin it to ~55% for no visual gain.
  player: { maxNodes: 10, maxConnections: 18 },
};

export type DensityNote = {
  /** Connections drawn. */
  shownConnections: number;
  /** Connections in the scope before thinning. */
  totalConnections: number;
  /** Players drawn. */
  shownPlayers: number;
  /** Players in the scope before thinning. */
  totalPlayers: number;
  /** Share of the FULL scope's assisted creation the drawn connections represent, 0–100. */
  coverageOfScope: number;
  /** True when anything was dropped — i.e. when the plate must say so. */
  thinned: boolean;
};

export type ScopedGrain = {
  data: GrainResponse;
  note: DensityNote;
};

/**
 * Thin a grain response down to what the plate can draw legibly.
 *
 * Returns a NEW `GrainResponse` (same contract shape, so nothing downstream forks) plus a
 * note describing exactly what was dropped.
 *
 * Order matters: nodes first, then connections among the survivors. Capping connections
 * first would leave orphan players in the node list with nothing attached to them.
 */
export function scopeForPlate(
  data: GrainResponse,
  limits: DensityLimits,
): ScopedGrain {
  const totalConnections = data.edges.length;
  const totalPlayers = data.players.length;
  const totalCount = data.edges.reduce((sum, edge) => sum + edge.count, 0);

  // Involvement = creation originated PLUS received. A player matters to this plate if
  // they are at either end of real creation, not only if they pass.
  const involvement = new Map<number, number>();
  for (const edge of data.edges) {
    involvement.set(edge.assisterId, (involvement.get(edge.assisterId) ?? 0) + edge.count);
    involvement.set(edge.shooterId, (involvement.get(edge.shooterId) ?? 0) + edge.count);
  }

  let keptPlayers = data.players;
  if (limits.maxNodes !== null && data.players.length > limits.maxNodes) {
    keptPlayers = [...data.players]
      .sort(
        (a, b) =>
          (involvement.get(b.personId) ?? 0) - (involvement.get(a.personId) ?? 0)
          // Deterministic tie-break so the plate does not reshuffle between renders.
          || a.personId - b.personId,
      )
      .slice(0, limits.maxNodes);
  }

  const keptIds = new Set(keptPlayers.map((player) => player.personId));

  let keptEdges = data.edges.filter(
    (edge) => keptIds.has(edge.assisterId) && keptIds.has(edge.shooterId),
  );

  if (limits.maxConnections !== null && keptEdges.length > limits.maxConnections) {
    keptEdges = [...keptEdges]
      .sort(
        (a, b) =>
          b.count - a.count
          || a.assisterId - b.assisterId
          || a.shooterId - b.shooterId,
      )
      .slice(0, limits.maxConnections);
  }

  // Shots stay filtered to the kept players so the node fills (each player's assisted
  // split) still describe the players actually drawn.
  const keptShots = data.shots.filter((shot) => keptIds.has(shot.shooterId));

  const keptCount = keptEdges.reduce((sum, edge) => sum + edge.count, 0);
  const coverageOfScope = totalCount > 0 ? (keptCount / totalCount) * 100 : 0;

  const note: DensityNote = {
    shownConnections: keptEdges.length,
    totalConnections,
    shownPlayers: keptPlayers.length,
    totalPlayers,
    coverageOfScope,
    thinned: keptEdges.length < totalConnections || keptPlayers.length < totalPlayers,
  };

  if (!note.thinned) return { data, note };

  return {
    data: {
      ...data,
      players: keptPlayers,
      edges: keptEdges,
      shots: keptShots,
      meta: {
        ...data.meta,
        shotCount: keptShots.length,
        edgeCount: keptEdges.length,
      },
    },
    note,
  };
}

/**
 * The plate's honesty line for a thinned scope.
 *
 * Names both what is drawn and what it covers. "Top 18 of 286" alone would be technically
 * true and practically misleading — 18 of 286 sounds like a rounding error until you know
 * those 18 carry a majority of the creation among the players shown.
 */
export function densityNoteText(note: DensityNote): string | null {
  if (!note.thinned) return null;

  const parts: string[] = [];
  if (note.shownPlayers < note.totalPlayers) {
    parts.push(`${note.shownPlayers} most-involved of ${note.totalPlayers} players`);
  }
  parts.push(
    `top ${note.shownConnections} of ${note.totalConnections} connections`,
  );
  return `SHOWING ${parts.join(' · ')} — ${Math.round(note.coverageOfScope)}% OF ASSISTED CREATION`;
}
