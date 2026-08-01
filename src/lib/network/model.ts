import { scaleLinear } from 'd3-scale';

import type { AssistEdge, GrainResponse } from '@/lib/contracts';
import { color as palette, encoding, network } from '@/lib/design/tokens';

/**
 * Turns a `GrainResponse` into everything the Creation Network plate draws.
 *
 * Pure functions over the contract — no React, no DOM, no fetching. That is what makes the
 * encoding testable: role position, share, the acid threshold and the reading annotation
 * are all claims about the data, and each is asserted in tests/network-model.test.ts.
 *
 * d3-scale is used as a maths helper for positioning only. React owns every element.
 */

export type RoleNode = {
  personId: number;
  name: string;
  /** Share of the unit's assisted creation this player ORIGINATES (0–1). */
  originatedShare: number;
  /** Share this player RECEIVES (0–1). */
  receivedShare: number;
  /** originated − received, in [-1, 1]. Drives vertical placement. */
  roleBalance: number;
  /** Fraction of this player's made baskets that were assisted (0–1), or null if none. */
  assistedPct: number | null;
  /** Made baskets, for honesty about sample size behind `assistedPct`. */
  madeBaskets: number;
  x: number;
  y: number;
  /** Display index, "01".."05", ordered by origination. */
  index: string;
};

export type Strand = {
  d: string;
  color: string;
  width: number;
  dash: string;
  opacity: number;
  /** Only the centre strand of a bundle carries the arrowhead. */
  marker: 'warm' | 'acid' | null;
};

export type ArcLabel = {
  x: number;
  y: number;
  text: string;
  color: string;
  /** Which connection this label belongs to, so it can dim with its arc. */
  assisterId: number;
  shooterId: number;
};

/**
 * One connection's strands, kept together so the arc can be a single interactive target.
 *
 * A bundle is many hairlines but ONE connection — the user clicks the connection, not a
 * strand. Grouping here (rather than flattening as the design's static export did) is what
 * lets the plate attach a hit area, focus, and selection to the thing that has meaning.
 */
export type StrandBundle = {
  assisterId: number;
  shooterId: number;
  strands: Strand[];
  /** A single fat invisible path for hit-testing and focus — thin arcs are hard to hit. */
  hitPath: string;
  share: number;
  isHighValue: boolean;
};

export type Connection = {
  assisterId: number;
  shooterId: number;
  count: number;
  /** Percentage of the unit's total assisted creation, 0–100. */
  share: number;
  /** Points per made basket — 2.00 to 3.00. See `acidThreshold`. */
  pointsPerBasket: number;
  isHighValue: boolean;
};

/**
 * The acid-accent threshold, in points per MADE basket.
 *
 * The design encodes "acid = 1.42+ pts / attempt". That number cannot be used here, and
 * the reason matters: `AssistEdge` counts only made baskets, and the Phase 2 contract
 * forbids an assisted miss, so attempts-per-connection is not derivable from this data at
 * all. Points per made basket therefore ranges 2.00 (all twos) to 3.00 (all threes), and
 * applying 1.42 to it would paint EVERY connection acid — verified against the real top
 * lineup: 20 of 20.
 *
 * So the design's INTENT is preserved rather than its literal constant: acid marks the
 * genuinely high-value connections and stays rare. 2.70 keeps it at roughly the top
 * quarter–third of connections (6 of 20 on the top lineup), which is what the design's
 * plate shows — 2 acid arcs out of 12.
 *
 * Stated plainly in the ENCODING legend so the plate never implies a per-attempt figure
 * it does not have.
 */
export const ACID_THRESHOLD_PPB = 2.7;

/** Percent formatting. `assistedPct` serialises as `1`, not `1.0` — always format. */
export function formatPct(value: number | null, digits = 0): string {
  if (value === null) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

/** Share formatting, matching the design's `fmt`: whole numbers bare, else one decimal. */
export function formatShare(share: number): string {
  return `${share % 1 === 0 ? share.toFixed(0) : share.toFixed(1)}%`;
}

/**
 * Per-connection shares of the unit's total assisted creation.
 *
 * Shares are over made assisted baskets, so they sum to 100% by construction — which is
 * exactly what the design's header claims ("ARCS SUM TO 100% OF ASSISTED CREATION").
 */
export function buildConnections(edges: AssistEdge[]): Connection[] {
  const total = edges.reduce((sum, edge) => sum + edge.count, 0);
  if (total === 0) return [];

  return edges
    .map((edge) => {
      const pointsPerBasket = edge.points / edge.count;
      return {
        assisterId: edge.assisterId,
        shooterId: edge.shooterId,
        count: edge.count,
        share: (edge.count / total) * 100,
        pointsPerBasket,
        isHighValue: pointsPerBasket >= ACID_THRESHOLD_PPB,
      };
    })
    .sort((a, b) => b.share - a.share);
}

/**
 * Per-player assisted split, from the shots this scope actually contains.
 *
 * Honest by construction: a player's empty node fill is their self-created share, computed
 * from real makes. A player with no made baskets gets null, not 0 — "no data" and "0%
 * assisted" are different claims, and the node renders empty with an em dash rather than
 * implying a pure self-creator.
 */
export function playerSplits(
  response: GrainResponse,
): Map<number, { assistedPct: number | null; madeBaskets: number }> {
  const tally = new Map<number, { made: number; assisted: number }>();

  for (const shot of response.shots) {
    if (!shot.made) continue;
    const entry = tally.get(shot.shooterId) ?? { made: 0, assisted: 0 };
    entry.made += 1;
    // `assisted` is the tag, not `assisterId !== null`: a tagged basket whose assister
    // could not be resolved is still assisted. Using the id here would silently push
    // unresolved assists into "self-created" and misstate the fill.
    if (shot.assisted) entry.assisted += 1;
    tally.set(shot.shooterId, entry);
  }

  const splits = new Map<number, { assistedPct: number | null; madeBaskets: number }>();
  for (const player of response.players) {
    const entry = tally.get(player.personId);
    splits.set(player.personId, {
      assistedPct: entry && entry.made > 0 ? entry.assisted / entry.made : null,
      madeBaskets: entry?.made ?? 0,
    });
  }
  return splits;
}

/**
 * Horizontal columns for N nodes, alternating outward from the plate's centre.
 *
 * Wider scopes need more lanes, so the span grows with the node count until it reaches the
 * plate's usable width. Adjacent ROLE ranks land in non-adjacent columns, which is what
 * stops bundles between similarly-ranked players from stacking on top of each other.
 */
export function roleColumns(count: number): number[] {
  const mid = network.viewBox.width / 2;
  if (count <= 1) return [mid];

  // The five-node case is the resolved design's own spacing and is preserved exactly —
  // the lineup grain is the plate as drawn, and generalising must not quietly restyle it.
  if (count <= 5) {
    return [mid, mid - 250, mid + 250, mid - 430, mid + 430].slice(0, count);
  }

  // Wider scopes fan out to the plate's usable width, leaving a gutter for node labels.
  const half = network.viewBox.width / 2 - 90;
  const lanes: number[] = [mid];
  const perSide = Math.ceil((count - 1) / 2);
  for (let i = 1; i <= perSide; i += 1) {
    const offset = (half * i) / perSide;
    lanes.push(mid - offset, mid + offset);
  }
  return lanes.slice(0, count);
}

/**
 * Place the players in role-space.
 *
 * Vertical axis is creation ORIGINATED versus RECEIVED — the design's whole premise
 * ("creators above, scorers below"). A player who originates more than they receive rises
 * toward the ORIGINATES band; one who receives more sinks toward RECEIVES.
 *
 * Horizontal placement is legibility only, and carries NO meaning — nodes are spread by
 * rank so bundles do not stack. The plate says so in its axis caption (vertical axis is
 * labelled; horizontal is not), and nothing in the encoding legend claims an x meaning.
 */
export function buildRoleNodes(response: GrainResponse): RoleNode[] {
  const totalCount = response.edges.reduce((sum, edge) => sum + edge.count, 0);
  const splits = playerSplits(response);

  const originated = new Map<number, number>();
  const received = new Map<number, number>();
  for (const edge of response.edges) {
    originated.set(edge.assisterId, (originated.get(edge.assisterId) ?? 0) + edge.count);
    received.set(edge.shooterId, (received.get(edge.shooterId) ?? 0) + edge.count);
  }

  const players = response.players.map((player) => {
    const originatedShare = totalCount
      ? (originated.get(player.personId) ?? 0) / totalCount
      : 0;
    const receivedShare = totalCount
      ? (received.get(player.personId) ?? 0) / totalCount
      : 0;
    const split = splits.get(player.personId) ?? { assistedPct: null, madeBaskets: 0 };
    return {
      personId: player.personId,
      name: player.displayName,
      originatedShare,
      receivedShare,
      roleBalance: originatedShare - receivedShare,
      assistedPct: split.assistedPct,
      madeBaskets: split.madeBaskets,
    };
  });

  // Vertical: most creator-ish at the ORIGINATES band, most scorer-ish at RECEIVES.
  // Scaled to the observed spread rather than a fixed [-1,1] so the five always use the
  // full height — with five players the raw balances cluster near zero, and a fixed domain
  // would collapse them into an unreadable band.
  const balances = players.map((p) => p.roleBalance);
  const spread = Math.max(Math.abs(Math.min(...balances)), Math.abs(Math.max(...balances)), 0.01);
  const yScale = scaleLinear()
    .domain([spread, -spread])
    .range([network.originatesY + 32, network.receivesY - 34])
    .clamp(true);

  // Horizontal: zig-zag across the full width by role rank, so adjacent ranks never sit
  // in the same column and the bundles between them have room to read. Legibility only —
  // x carries no meaning, which is why only the vertical axis is labelled.
  //
  // Columns alternate outward from the centre (centre → left → right → far-left → …),
  // matching the design's own spread and staying symmetric so the plate never drifts to
  // one side. GENERATED rather than hardcoded: the five-element list this replaced worked
  // only for a five-man lineup, and returned `undefined` — an unpositioned node — as soon
  // as the team grain arrived with more players than columns.
  const byRole = [...players].sort((a, b) => b.roleBalance - a.roleBalance);
  const columns = roleColumns(players.length);

  const ranked = [...players].sort((a, b) => b.originatedShare - a.originatedShare);

  const placed = players.map((player) => {
    const roleRank = byRole.findIndex((p) => p.personId === player.personId);
    const originRank = ranked.findIndex((p) => p.personId === player.personId);
    return {
      ...player,
      x: columns[roleRank],
      y: yScale(player.roleBalance),
      index: String(originRank + 1).padStart(2, '0'),
    };
  });

  return separateLabels(placed);
}

/**
 * Push apart nodes whose LABELS would overprint.
 *
 * `y` is driven entirely by role balance, which is the right encoding — but in a player
 * scope most teammates are pure receivers with near-identical balances, so they collapse
 * into one horizontal band and their name/readout blocks land on top of each other
 * ("WOLF" over "TRAORE", "SHARPE" over "CLOWNEY"). Observed on the real Porter Jr. plate.
 *
 * This nudges only nodes that actually collide, and only vertically, so the role encoding
 * survives: a node never crosses another in role order, it just gets breathing room. Nodes
 * far enough apart horizontally are left exactly where the scale put them, which is why a
 * five-man lineup — the resolved design — comes through untouched.
 */
function separateLabels<T extends { x: number; y: number }>(nodes: T[]): T[] {
  // A label block is roughly this tall (index + name + readout), and only nodes sharing
  // horizontal space can overprint at all.
  //
  // X_OVERLAP is deliberately narrower than a label is wide. Labels sit on alternating
  // sides of their node (see `labelAnchor`), so two nodes a lane apart put their text in
  // opposite directions and clear each other. Treating every lane-neighbour as a collision
  // demanded 14 nodes in a column that fits 13 — an unsatisfiable constraint that just
  // pinned everything to the bottom rule.
  const MIN_GAP_Y = 34;
  const X_OVERLAP = 96;
  const top = network.originatesY + 20;
  const bottom = network.receivesY - 22;

  const adjusted = nodes.map((node) => ({ ...node }));

  // Sweeping once is not enough: pushing a node clear of one neighbour can shove it into
  // the next. Repeat until a full pass moves nothing, bounded so it always terminates.
  //
  // Every pass re-sorts by the CURRENT y. Ordering once up front and reusing it was a bug:
  // after a node is nudged the original order is stale, so a pair that has swapped places
  // is never re-compared and stays overlapping.
  //
  // This is a local relaxation, not a global solver: it resolves pairs, and a long chain of
  // nodes each already 34px apart can wedge one node into a 50px slot with nowhere to go.
  // Left deliberately simple, because that wedge needs every node at an identical role
  // balance — verified absent from every real scope (the team plate and all 22 player
  // plates come out with zero overlapping labels). A full constraint solver here would be
  // machinery for a case the data does not produce.
  const MAX_PASSES = 24;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    let moved = false;

    const order = adjusted
      .map((node, index) => ({ index, y: node.y, x: node.x }))
      .sort((a, b) => a.y - b.y || a.x - b.x);

    for (let i = 1; i < order.length; i += 1) {
      const current = adjusted[order[i].index]!;
      for (let j = 0; j < i; j += 1) {
        const earlier = adjusted[order[j].index]!;
        if (Math.abs(current.x - earlier.x) >= X_OVERLAP) continue;
        const gap = current.y - earlier.y;
        if (gap >= MIN_GAP_Y) continue;

        // Prefer pushing the lower node down; if it is already against the bottom rule,
        // lift the upper one instead. Without that fallback a pair can stay welded
        // together at the floor, which is exactly where crowded scopes pile up.
        const pushed = Math.min(earlier.y + MIN_GAP_Y, bottom);
        if (pushed > current.y + 1e-9) {
          current.y = pushed;
          moved = true;
          continue;
        }

        const lifted = Math.max(current.y - MIN_GAP_Y, top);
        if (lifted < earlier.y - 1e-9) {
          earlier.y = lifted;
          moved = true;
        }
      }
    }

    if (!moved) break;
  }

  return adjusted;
}

/**
 * Build the woven strand bundles.
 *
 * A direct port of the design's `buildStrands`: bundle size, stroke width, dash, opacity
 * and the centre-strand arrowhead all follow the same rules, so the rebuild draws the same
 * marks. Density encodes share — that is the encoding the legend promises.
 */
export function buildStrands(
  connections: Connection[],
  nodes: RoleNode[],
  colors: { warm: string; acid: string },
): { strands: Strand[]; bundles: StrandBundle[]; labels: ArcLabel[] } {
  const byId = new Map(nodes.map((node) => [node.personId, node]));
  const { nodeRadius: R, nodeGap: GAP, curvature, weaveSpread } = network;

  const beads: Strand[] = [];
  const ribbons: Strand[] = [];
  const hot: Strand[] = [];
  const labels: ArcLabel[] = [];
  const bundles: StrandBundle[] = [];

  // The scope's largest connection sets the top of the magnitude scale, so the leader
  // always maxes out the strand count whatever the absolute shares happen to be.
  const topShare = connections.reduce((max, c) => Math.max(max, c.share), 0);

  for (const connection of connections) {
    const from = byId.get(connection.assisterId);
    const to = byId.get(connection.shooterId);
    if (!from || !to) continue;

    let dx = to.x - from.x;
    let dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    dx /= length;
    dy /= length;

    const sx = from.x + dx * (R + GAP);
    const sy = from.y + dy * (R + GAP);
    const ex = to.x - dx * (R + GAP + 4);
    const ey = to.y - dy * (R + GAP + 4);
    const mx = (sx + ex) / 2;
    const my = (sy + ey) / 2;
    const bow = length * curvature;

    const { share, isHighValue } = connection;
    const color = isHighValue ? colors.acid : colors.warm;

    /**
     * Two visual registers, and the split between them is the plate's first read:
     *
     *   DOMINANT (>= 6% share) — a solid woven bundle. These are the connections that
     *     define the unit.
     *   FAINT (< 6%) — one or two DOTTED hairlines that recede into texture. They are
     *     real and shown, but they must not compete.
     *
     * Losing the dotted register (a Stage 3/4 regression) made every connection read as
     * a similar solid strand and the plate turned into a knot.
     */
    const dense = share >= encoding.denseMinShare;

    /**
     * Strand count IS the magnitude encoding — the primary read.
     *
     * Scaled RELATIVE to this scope's largest connection rather than off an absolute
     * share, and squared so the curve is convex. Absolute scaling collapsed the range: on
     * the real top lineup a 14.1% connection drew 7 strands against 4 for an 8.2%, which
     * no viewer can rank at a glance. Relative-and-convex gives the leader 18 against 9,
     * so the dominant connection is visibly twice the next tier and the ranking is
     * legible without reading a single label.
     */
    const relative = topShare > 0 ? share / topShare : 0;
    const scaled = dense
      ? Math.max(
        encoding.denseMinStrands,
        Math.round(
          encoding.denseMinStrands
            + relative * relative * (encoding.denseMaxStrands - encoding.denseMinStrands),
        ),
      )
      : share >= encoding.faintPairShare ? 2 : 1;
    // Dominant bundles carry an ODD number of strands so exactly one sits at the centre
    // and takes the arrowhead. With an even count the midpoint falls between two strands
    // and both would qualify, giving a connection two heads.
    const count = dense && scaled % 2 === 0 ? scaled + 1 : scaled;

    // Heavier bundles also spread wider, so magnitude reads as mass, not just line count.
    const spread = dense ? weaveSpread * (1 + relative * 0.72) : weaveSpread;

    const bucket = isHighValue ? hot : dense ? ribbons : beads;
    const mid = (count - 1) / 2;
    const own: Strand[] = [];

    for (let j = 0; j < count; j += 1) {
      const offset = bow + (j - mid) * spread;
      const qx = mx + dy * offset;
      const qy = my - dx * offset;
      const isCentre = Math.abs(j - mid) < 0.6;
      const strand: Strand = {
        d: `M${sx.toFixed(1)},${sy.toFixed(1)} Q${qx.toFixed(1)},${qy.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`,
        color,
        width: dense ? 0.5 : 1.05,
        // The dotted register. `none` is a solid stroke; the sparse pattern is what makes
        // a faint connection read as delicate rather than thin-but-solid.
        //
        // Legibility tuning: the design's '0.1 5.4' dash is a 0.1px dot every 5.4px, which
        // at 0.42 opacity was imperceptible on a bone ground. The fix is a longer dot and a
        // tighter gap — MORE INK, not more colour. Pushing opacity alone (tried at 0.6) made
        // the dotted arcs read as bold red lines competing with the solid bundles, which
        // inverts the magnitude encoding. 0.5 with the denser dash reads as delicate
        // texture that is clearly present and still clearly subordinate.
        dash: dense ? 'none' : '0.5 3.4',
        opacity: dense ? (isHighValue ? 0.85 : 0.7) : isHighValue ? 0.62 : 0.5,
        marker: isCentre ? (isHighValue ? 'acid' : 'warm') : null,
      };
      bucket.push(strand);
      own.push(strand);
    }

    // The centre line of the bundle, used as the invisible hit/focus target. One fat
    // path is a far better click target than a dozen half-pixel hairlines.
    const centreQx = mx + dy * bow;
    const centreQy = my - dx * bow;
    bundles.push({
      assisterId: connection.assisterId,
      shooterId: connection.shooterId,
      strands: own,
      hitPath: `M${sx.toFixed(1)},${sy.toFixed(1)} Q${centreQx.toFixed(1)},${centreQy.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`,
      share,
      isHighValue,
    });

    // Labels only on the connections worth naming; the rest read as texture.
    if (share >= encoding.labelMinShare) {
      // Point on the outer edge of the bundle, at the quarter-point along the arc rather
      // than its midpoint — with many connections crossing the middle of the plate, the
      // midpoints all pile up in one place.
      const lo = bow + (dense ? mid * weaveSpread : 0);
      const t = 0.34;
      const qx = mx + dy * lo;
      const qy = my - dx * lo;
      const px = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * qx + t * t * ex;
      const py = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * qy + t * t * ey;

      // Offset PERPENDICULAR to the arc, on the bow's side, so the label clears its own
      // strands instead of being pushed toward the plate centre where everything crowds.
      const side = Math.sign(lo) || 1;
      labels.push({
        x: px + dy * side * 13,
        y: py - dx * side * 13 + 3,
        text: formatShare(Math.round(share * 10) / 10),
        // Read from the tokens rather than repeating the hexes: these literals predated
        // the token audit, so darkening acidDeep/rustDeep for legibility silently skipped
        // the arc labels — the one place the % is actually data.
        color: isHighValue ? palette.acidDeep : palette.rustDeep,
        assisterId: connection.assisterId,
        shooterId: connection.shooterId,
      });
    }
  }

  return { strands: [...beads, ...ribbons, ...hot], bundles, labels };
}

/**
 * Origination bars: who creates, ordered, as a share of assisted creation.
 *
 * `scope` is the FULL grain response, before any density thinning. On a thinned team plate
 * the node's own `originatedShare` is measured against the drawn subgraph, so the bars
 * renormalised to 100% and implied the eight shown names were the whole roster's creation
 * — Claxton read 27.2% when his true team share is 13.0%. Passing the unthinned scope makes
 * each bar a true share of the season; the bars then sum to the coverage the density note
 * already discloses (~31%) instead of to a flattering 100%.
 *
 * For an uncapped grain the two denominators are identical, so nothing changes there.
 */
export function buildOrigination(nodes: RoleNode[], scope?: GrainResponse) {
  const scopeTotal = scope
    ? scope.edges.reduce((sum, edge) => sum + edge.count, 0)
    : 0;

  const originatedInScope = new Map<number, number>();
  if (scope) {
    for (const edge of scope.edges) {
      originatedInScope.set(
        edge.assisterId,
        (originatedInScope.get(edge.assisterId) ?? 0) + edge.count,
      );
    }
  }

  return [...nodes]
    .map((node) => {
      const share = scope && scopeTotal
        ? ((originatedInScope.get(node.personId) ?? 0) / scopeTotal) * 100
        : node.originatedShare * 100;
      return {
        personId: node.personId,
        name: node.name,
        share,
        label: formatShare(Math.round(share * 10) / 10),
      };
    })
    .sort((a, b) => b.share - a.share);
}

/**
 * The §C / READING annotation, computed from the data — never hardcoded.
 *
 * Says three true things: how concentrated the creation is, who carries it, and who the
 * unit's finishers are. Wording adapts to what the numbers actually show, so a distributed
 * unit does not get described as concentrated.
 */
export function buildReading(
  connections: Connection[],
  nodes: RoleNode[],
): string {
  if (connections.length === 0 || nodes.length === 0) {
    return 'No assisted creation recorded for this unit.';
  }

  const top = connections[0];
  const byId = new Map(nodes.map((node) => [node.personId, node]));
  const creator = byId.get(top.assisterId)?.name ?? 'unknown';
  const scorer = byId.get(top.shooterId)?.name ?? 'unknown';

  // Top-third concentration is the honest summary statistic here: with 20 connections a
  // single share is small by construction, so leading with one number would understate
  // how concentrated the unit really is.
  const topThree = connections.slice(0, 3).reduce((sum, c) => sum + c.share, 0);
  const character = topThree >= 40 ? 'concentrated' : topThree >= 28 ? 'balanced' : 'distributed';

  const originators = [...nodes].sort((a, b) => b.originatedShare - a.originatedShare);
  const leadCreator = originators[0];

  // "Finisher" = receives most while originating least — the clearest scorer.
  //
  // `assistedPct === null` means we have NO made baskets for that player in this scope, so
  // there is no split to state. Naming them here printed a bare em-dash into the middle of
  // a sentence ("Williams on — assisted") on 20 of 22 player grains. A null is a value we
  // do not have, not a value of zero, so the honest move is to leave them out rather than
  // describe them with a placeholder.
  const finishers = [...nodes]
    .filter((node) => node.receivedShare > node.originatedShare && node.assistedPct !== null)
    .sort((a, b) => b.receivedShare - a.receivedShare);

  const sentences: string[] = [];

  sentences.push(
    `Creation is ${character}: the top three connections carry ${formatShare(Math.round(topThree * 10) / 10)} `
      + `of everything this unit assists, led by ${creator} to ${scorer} at ${formatShare(Math.round(top.share * 10) / 10)}.`,
  );

  sentences.push(
    `${leadCreator.name} originates ${formatPct(leadCreator.originatedShare)} of it.`,
  );

  // With no qualifying finisher the clause is simply omitted — an empty "They finish
  // through ." is worse than saying nothing.
  if (finishers.length > 0) {
    const named = finishers.slice(0, 2);
    const description = named
      .map((node) => `${node.name} on ${formatPct(node.assistedPct)} assisted`)
      .join(' and ');
    sentences.push(`${named.length > 1 ? 'They finish through' : 'It finishes through'} ${description}.`);
  }

  return sentences.join(' ');
}
