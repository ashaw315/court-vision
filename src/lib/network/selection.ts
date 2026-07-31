import type { AssistEdge } from '@/lib/contracts';

/**
 * Connection selection — the state that fuses the two plates into one instrument.
 *
 * Pure functions and a plain type, so the selection rules are testable without a browser.
 * The component owns the state; this owns the meaning.
 */

/** A selected connection, identified the way the contract identifies an edge. */
export type ConnectionSelection = {
  assisterId: number;
  shooterId: number;
};

/** Do these refer to the same connection? Direction matters — A→B is not B→A. */
export function isSameConnection(
  a: ConnectionSelection | null,
  b: ConnectionSelection | null,
): boolean {
  if (a === null || b === null) return false;
  return a.assisterId === b.assisterId && a.shooterId === b.shooterId;
}

/**
 * Clicking a connection toggles it.
 *
 * Clicking the selected connection again deselects, which is the "click the selected arc
 * again" affordance the interaction model calls for — and it means a user can always get
 * back to the resting state through the same gesture that got them here.
 */
export function toggleSelection(
  current: ConnectionSelection | null,
  clicked: ConnectionSelection,
): ConnectionSelection | null {
  return isSameConnection(current, clicked) ? null : clicked;
}

/**
 * Is this connection the selected one?
 *
 * Used for both emphasis and dimming: exactly one connection is full-strength while a
 * selection exists, and everything else recedes.
 */
export function isSelected(
  selection: ConnectionSelection | null,
  edge: Pick<AssistEdge, 'assisterId' | 'shooterId'>,
): boolean {
  return isSameConnection(selection, {
    assisterId: edge.assisterId,
    shooterId: edge.shooterId,
  });
}

/**
 * Should this element be dimmed?
 *
 * Nothing dims at rest — the resting plate is the Stage 1 plate, unchanged. Dimming only
 * exists to tie the emphasised arc to the court beside it.
 */
export function isDimmed(
  selection: ConnectionSelection | null,
  edge: Pick<AssistEdge, 'assisterId' | 'shooterId'>,
): boolean {
  if (selection === null) return false;
  return !isSelected(selection, edge);
}

/**
 * Is this player an endpoint of the selected connection?
 *
 * The two endpoint nodes stay full-strength with the selected arc — they are what the
 * connection IS, and dimming them would break the visual link to the court's caption.
 */
export function isEndpoint(
  selection: ConnectionSelection | null,
  personId: number,
): boolean {
  if (selection === null) return false;
  return selection.assisterId === personId || selection.shooterId === personId;
}

/** A player node recedes only when a selection exists and they are not part of it. */
export function isNodeDimmed(
  selection: ConnectionSelection | null,
  personId: number,
): boolean {
  if (selection === null) return false;
  return !isEndpoint(selection, personId);
}

/** Opacity multiplier for receded elements. Low enough to recede, high enough to read. */
export const DIM_OPACITY = 0.16;

/** Screen-reader/tooltip label for a connection's interactive target. */
export function connectionLabel(
  assisterName: string,
  shooterName: string,
  share: number,
  selected: boolean,
): string {
  return (
    `${assisterName} to ${shooterName}, ${share.toFixed(1)}% of unit creation.`
    + ` ${selected ? 'Selected. Activate to clear.' : 'Activate to show its shots on the court.'}`
  );
}
