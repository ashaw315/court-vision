# ETL

Pulls public NBA data (shots, passing, lineups) for the Brooklyn Nets, transforms it
into the normalized shape, and loads it into Postgres.

**Not yet implemented** — this arrives in Phase 3.

## This runs locally, never in the deploy

`stats.nba.com` returns **403 from cloud IPs**. The ETL is a manual, offline seeding
step run from a machine on an allowed network. The deployed app never calls the NBA
endpoints — it only reads from Postgres.

That separation is deliberate architecture, not a workaround.

## Environment

Python 3.13 via the repo-root venv (gitignored). `nba_api` is the only direct
dependency the pulls need.

```
.venv/bin/python etl/<script>.py
```

## Tests

Transforms are tested against saved endpoint responses in `scratch/` (gitignored),
so the test suite never hits a live NBA endpoint. Those fixtures are real responses
in NBA-stats' `{headers, rows}` column-array shape — every transform zips headers to
rows.
