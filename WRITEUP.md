# Court Vision

## Summary

Court Vision reads how a basketball team builds its offense — not where shots come from, but *how they get created*: who sets up whom, and where those baskets land. It covers the Brooklyn Nets' 2025-26 regular season at three scopes: the whole team, a five-man lineup, or a single player.

The goal is to guide analysis, not perform it — surface what's real, and let a coach, scout, or exec bring the judgment. It's built for the Nets, but the pipeline is team-agnostic: pointing it at another team is a parameter change, not a rebuild.

## The concept, and why it's shaped this way

The original idea was more ambitious — an animated possession tracker showing how offense unfolds and spacing gets created. But that needs player-tracking data (the league's Second Spectrum optical feed), which isn't public and is protected under the collective bargaining agreement. Establishing that limit was early work.

Rather than fake positions I couldn't source, I built what the public data supports — and the constraint produced a cleaner idea. Play-by-play won't say where every player stood, but for every made basket it gives who scored, who assisted, and where. That answers a sharper question than "how does the offense move": **how does it get *created*** — who creates for whom, how much of a unit's scoring runs through each connection, and where those baskets happen.

Two choices followed:

- **Observational, not predictive.** The tool shows what happened, not what might. That's a role fit — a full-stack engineer integrates the analytics team's models rather than building them — and a discipline: every number reconciles to the real record, which a projection can't.
- **Creation, not ball movement.** "Ball movement" implies passes the data can't fully see. "Creation" — the assist that directly produces a made basket — is exactly what the data records, and the more useful question.

## Data integrity

A tool that informs real decisions is only worth the trust in its numbers. Two guarantees sit underneath it:

- **The contract guarantees shape.** Every data shape — a shot, an assist, a lineup — is defined once and validated at every boundary (pipeline, API, frontend) with Zod, a runtime schema validator. A record that doesn't match fails there instead of drifting downstream: one definition, from raw data to screen.
- **Reconciliation guarantees the values.** A well-formed number isn't a correct one, so the pipeline's output is checked against the official box scores — across all 72 games, field goals and assists reconcile exactly, and minutes to within two seconds per player. A derived number that disagrees with the league's record fails rather than passing quietly.

Right shape, true values. A few decisions build on that:

- **72 of 82 games.** Ten games were excluded because their substitution timestamps contradict themselves in the source, making it impossible to reconstruct who was on the floor. Rather than guess a lineup — fabricating who played during real possessions — those games were dropped. Seventy-two clean games paint the picture clearly, and every remaining number stays honest.
- **Never fabricate.** The assisting player appears in the play-by-play only as a surname. Where it identifies one player, the assist is attributed; where it could mean two, it's recorded as unknown, never guessed. No connection is inferred — every edge is a resolved fact, with zero unresolved assisters in the final dataset, and a figure that can't be computed honestly isn't shown.
- **Verified by trying to break it.** Repeated adversarial reviews caught real bugs that passing tests missed — a coordinate transform with a units error that still produced a plausible-looking chart, a label true in one view and false in another. Every piece of displayed text was audited claim by claim across all three views, and re-audited until the audits found nothing new.

## Architecture and technology choices

One direction, validated at each boundary:

**NBA play-by-play → Python ETL → Zod contract → Neon Postgres (Drizzle) → typed API → React/SVG frontend → Vercel.**

- **The ETL** pulls raw play-by-play, reshapes it, and loads it. The transform stage does the real work — parsing the assister from free text, deriving the on-court five from substitution events, computing each connection's share — and it's where the integrity decisions live.
- **A contract-first spine.** The shapes defined above are enforced at each boundary, keeping the stack type-safe end to end and catching drift the moment it happens.
- **Neon Postgres, for static data.** The season's over, so this could have shipped as flat files. I used a managed Postgres with typed schemas and migrations anyway: it's the honest architecture for a basketball ops data layer that grows across a season, and it enforces referential integrity — a shot can't reference a player who doesn't exist. Drizzle keeps the database types aligned with the stack.
- **Hand-rolled SVG, not a charting library.** The visualization is bespoke — density-encoded arc bundles, role-positioned nodes, a custom draw-in. D3 is built for standard charts; for a fully custom plate it becomes something to fight. Rendering SVG directly in React gave full control and made the animation natural; D3 is used only for scale math, never for rendering.
- **Next.js on Vercel.** Frontend and read-only API in one typed app, reading only from the database — never re-fetching from the NBA at runtime.

Each choice is sized to the job: a real database and strict contract because integrity is the point, a bespoke renderer because the visual language is the differentiator, nothing heavier.

## Design

The visual language is my own — a "scientific plate" style I already work in, chosen as a deliberate differentiator. A few decisions do the real work:

- **The network is the hero; the court is the companion.** The creation network — who sets up whom — is the centerpiece, because how a unit generates offense is the harder question. The court map appears when you drill into a connection, showing where those baskets land.
- **Every encoding carries one real dimension.** Three things matter, each with its own channel: how much a connection is used (arc density), how valuable its baskets are (a green accent), and how much a player depends on teammates (node fill). Nothing is decorative.
- **Position encodes role.** Creators toward the top, finishers toward the bottom — a unit's shape is legible before you read a number. In the single-player view the subject sits at the center: the same instrument, refocused.
- **The palette is mine, not the team's.** Beyond being a differentiator, the Nets' colors would collide with the green-means-high-value encoding. The restraint is the point.

## Scope: what's deliberately out

The reasons matter as much as what's in:

- **Misses and shot attempts.** The tool is about *created* offense. Adding misses changes the question from "how does this unit score" to "how does it shoot" — a different tool.
- **Play-type context.** How a basket was generated (pick-and-roll, transition) is available through Synergy data, but reliable integration was beyond scope — a natural next layer, not a gap.
- **Anything predictive.** No projections or simulations — those belong to the analytics team's modeling, and would trade verifiability for a confidence this tool can't earn.
- **Future directions.** Other teams are a parameter change away. Beyond that — Synergy play-type context, multi-season data — the contract-first pipeline and relational layer were built so new sources, scopes, and views can be added without reworking the foundation.

## AI-tool disclosure

I used AI tools throughout, and a project about data integrity should be transparent about its process.

- **Concept and direction are mine** — the creation-network idea, the observational framing, the three scopes, and the visual aesthetic I already work in.
- **Claude, as a planning partner** — pressure-testing decisions, working through tradeoffs, catching blind spots. The reasoning is mine, sharpened in dialogue.
- **Claude Code, as pair programmer** — the ETL, contract, database, API, and frontend were implemented in collaboration. I directed the work, made the architectural and design decisions, reviewed every change, and owned the commits. The adversarial reviews were part of this: having it try to break its own work, which repeatedly caught real bugs.
- **Claude Design** — resolved a couple of static reference states early; a minor role, as most of the design is mine.

Core prompts and staged build plans are preserved in the `phases/` folder.

The concept, design, direction, and judgment are mine; the implementation was AI-assisted and reviewed at every step — an honest picture of how good engineering gets done now.
