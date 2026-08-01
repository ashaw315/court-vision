/**
 * Reading-panel open/collapse policy.
 *
 * Pure so the choreography can be tested without a browser: the panel is open at rest, gives
 * its space to the court when a connection is selected, and stays wherever the reader last
 * put it after that.
 *
 * The subtlety is that a selection must collapse the panel ONCE, not pin it closed — a reader
 * who reopens the guide while a connection is showing has to keep it open, including when
 * they pick a different connection afterwards.
 */

export type PanelState = {
  /** Whether the panel is currently expanded. */
  open: boolean;
  /** Whether the reader has overridden the automatic collapse for the current selection. */
  userOverride: boolean;
};

export const initialPanelState: PanelState = { open: true, userOverride: false };

/**
 * Fold a selection change into the panel state.
 *
 * `hadSelection` / `hasSelection` are the before and after of the court being summoned.
 * Collapsing happens on the TRANSITION into a selection, so re-selecting while the reader
 * has deliberately reopened the panel does not slam it shut again.
 */
export function onSelectionChange(
  state: PanelState,
  hadSelection: boolean,
  hasSelection: boolean,
): PanelState {
  // Court arriving: hand it the space, unless the reader has said otherwise.
  if (!hadSelection && hasSelection) {
    return state.userOverride ? state : { open: false, userOverride: false };
  }
  // Court dismissed: back to the resting state, and forget any override.
  if (hadSelection && !hasSelection) {
    return initialPanelState;
  }
  return state;
}

/** The reader opened the panel by hand — respect that until the court is dismissed. */
export function openPanel(state: PanelState, hasSelection: boolean): PanelState {
  return { open: true, userOverride: hasSelection };
}

/** The reader collapsed the panel by hand. */
export function collapsePanel(state: PanelState): PanelState {
  return { open: false, userOverride: false };
}
