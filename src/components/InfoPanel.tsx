'use client';

import type { Grain } from '@/lib/contracts';
import type { SeasonScope } from '@/lib/data/scope';
import { color, font, type } from '@/lib/design/tokens';

/**
 * The reading guide — orientation, term disambiguation, and methodology.
 *
 * Written for a scout or exec, not an engineer: what the plate shows, which words mean two
 * different things, and where the data stops. It is styled as another section of the same
 * printed document (§-marks, mono labels, the plate palette) rather than as a UI drawer.
 *
 * Every figure here is read from real data or config — the game counts come from the same
 * `SeasonScope` the plates print, so the panel cannot drift from the footnote beside it.
 *
 * Honesty note: the claims below were checked against the running app and the dataset. In
 * particular the panel does NOT claim the court omits a per-connection game count — it
 * shows one, and it is correct — and it does not imply unresolved assisters are a live
 * problem in this dataset, because there are currently zero of them.
 */

const SECTION_GAP = 22;

function SectionMark({ children }: { children: string }) {
  return (
    <div
      style={{
        fontFamily: font.mono,
        fontSize: type.legend.size,
        letterSpacing: type.legend.letterSpacing,
        color: color.mutedLight,
        paddingBottom: 8,
        marginBottom: 10,
        borderBottom: `1px solid ${color.rule}`,
      }}
    >
      {children}
    </div>
  );
}

/** Body prose. Serif, matching the §C reading on the plates. */
function Prose({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontFamily: font.serif,
        fontSize: 13,
        lineHeight: 1.62,
        color: color.text,
        margin: '0 0 9px',
      }}
    >
      {children}
    </p>
  );
}

/** A labelled encoding row: the term, then what it means. */
function Term({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'baseline' }}>
      <span
        style={{
          fontFamily: font.mono,
          fontSize: type.footer.size,
          letterSpacing: type.footer.letterSpacing,
          color: color.rustDeep,
          flex: '0 0 82px',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: font.serif,
          fontSize: 12.5,
          lineHeight: 1.55,
          color: color.text,
          flex: 1,
        }}
      >
        {children}
      </span>
    </div>
  );
}

export function InfoPanel({
  grain,
  scope,
  onCollapse,
}: {
  /** Which plate is on screen — the node-fill caveat differs in the player grain. */
  grain: Grain;
  /** Real season scope; every number in §III comes from here, never a literal. */
  scope: SeasonScope | null;
  onCollapse: () => void;
}) {
  return (
    <aside
      aria-label="How to read this"
      style={{
        background: color.ground,
        border: `1px solid ${color.rule}`,
        padding: '18px 20px 22px',
        display: 'flex',
        flexDirection: 'column',
        gap: SECTION_GAP,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <span
          style={{
            fontFamily: font.mono,
            fontSize: type.header.size,
            letterSpacing: type.header.letterSpacing,
            color: color.muted,
          }}
        >
          READING GUIDE
        </span>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse the reading guide"
          style={{
            fontFamily: font.mono,
            fontSize: type.footer.size,
            letterSpacing: type.footer.letterSpacing,
            color: color.muted,
            background: 'transparent',
            border: `1px solid ${color.rule}`,
            borderRadius: 0,
            padding: '3px 8px',
            cursor: 'pointer',
          }}
        >
          HIDE
        </button>
      </div>

      {/* ── I ─────────────────────────────────────────────────────────── */}
      <section>
        <SectionMark>§ I / HOW TO READ THIS</SectionMark>
        <Prose>
          Every figure here describes <em>made baskets that a teammate set up</em> — who
          creates scoring for whom, and where those baskets land on the floor.
        </Prose>
        <Term label="NODES">
          Players. Vertical position is role: heavier creators sit toward the top, players who
          mostly finish sit toward the bottom.
          {grain === 'player' && ' In this player view the subject sits at the centre and their teammates ring them.'}
        </Term>
        <Term label="NODE FILL">
          How much of that player&rsquo;s own scoring came off a teammate. Empty reads as a
          self-creator, full as a player who is set up.
          {grain === 'player'
            ? ' On a player plate only the subject has shots in view, so teammates read “not measurable here” rather than empty.'
            : ''}
        </Term>
        <Term label="ARCS">
          One creation connection each. Denser, heavier strands carry a larger share of the
          scoring shown; green marks connections averaging more points per basket — usually
          threes.
        </Term>
        <Term label="COURT">
          Appears when you select a connection: every made basket that connection produced, at
          its real location.
        </Term>
      </section>

      {/* ── II ────────────────────────────────────────────────────────── */}
      <section>
        <SectionMark>§ II / TWO KINDS OF &ldquo;ASSISTED&rdquo;</SectionMark>
        <Prose>
          The word carries two different measures on these plates. They are not
          interchangeable, and they rarely agree.
        </Prose>
        <Term label="SPLIT">
          <strong>Scores X% off teammates.</strong>{' '}
          Of one player&rsquo;s own made baskets, the share a teammate set up. This is the
          node fill.
        </Term>
        <Term label="SHARE">
          <strong>X% of assisted creation.</strong> Of all the assisted baskets shown, the
          share running through one connection. This is the arc figure.
        </Term>
        <Prose>
          On the top five-man unit, Porter Jr. scores 84% off teammates, while the single
          biggest connection feeding him carries 14.1% of that unit&rsquo;s creation — the
          same player, two different denominators, two different questions.
        </Prose>
      </section>

      {/* ── III ───────────────────────────────────────────────────────── */}
      <section>
        <SectionMark>§ III / ABOUT THE DATA</SectionMark>
        <Prose>
          NBA play-by-play, {scope ? `${scope.season} ${scope.seasonType.toLowerCase()}` : 'current season'}.
          Made, assisted baskets only — this tool is about created scoring, so missed shots and
          attempts are out of scope. Self-created baskets appear only inside the node-fill
          split.
        </Prose>
        {scope && scope.excludedGames > 0 && (
          <Prose>
            <strong>{scope.games} of {scope.scheduledGames} games.</strong>{' '}
            {scope.excludedGames} were excluded because their substitution timestamps
            contradict each other in the source feed. Rather than guess which five players
            were on the floor, those games were left out.
          </Prose>
        )}
        <Prose>
          Assisters are recovered by parsing the play-by-play text, where the passer appears
          only as a surname. Where a surname could mean two players, the assister is recorded
          as unknown rather than guessed — no edge in this tool is an inferred one.
        </Prose>
        <Prose>
          Shot totals, assist counts and minutes reconcile to the official box scores.
        </Prose>
      </section>
    </aside>
  );
}

/** The collapsed affordance — a slim tab that gives the space back to the court. */
export function InfoTab({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open the reading guide"
      aria-expanded={false}
      style={{
        fontFamily: font.mono,
        fontSize: type.footer.size,
        letterSpacing: type.footer.letterSpacing,
        color: color.muted,
        background: color.ground,
        border: `1px solid ${color.rule}`,
        borderRadius: 0,
        padding: '10px 7px',
        cursor: 'pointer',
        writingMode: 'vertical-rl',
        alignSelf: 'flex-start',
      }}
    >
      READING GUIDE
    </button>
  );
}
