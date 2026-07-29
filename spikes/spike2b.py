"""
SPIKE 2b — THROWAWAY. V2 play-by-play is dead (returns empty); using V3.

PRIMARY question (unchanged): can we join a located shot (shotchartdetail) to a
play-by-play event that names the ASSISTER? If yes, fused assist->located-shot is real.

Run locally:
    source .venv/bin/activate
    python spike2b.py
"""

import json
import os
import time
from nba_api.stats.static import teams
from nba_api.stats.endpoints import teamgamelog, shotchartdetail, synergyplaytypes

# V3 lives in a different module path
from nba_api.stats.endpoints import playbyplayv3

SEASON = "2025-26"
SEASON_TYPE = "Regular Season"
OUT = "spike_out"
os.makedirs(OUT, exist_ok=True)

NETS_ID = [t for t in teams.get_teams() if t["abbreviation"] == "BKN"][0]["id"]
print(f"Nets team_id = {NETS_ID}\n")


def dump(name, obj):
    with open(os.path.join(OUT, name), "w") as f:
        json.dump(obj, f, indent=2)
    print(f"  wrote {OUT}/{name}")


def rows_as_dicts(rs):
    return [dict(zip(rs["headers"], r)) for r in rs["rowSet"]]


# ---- pick one Nets game ----
print("Finding one Nets game id ...")
gl = teamgamelog.TeamGameLog(
    team_id=NETS_ID, season=SEASON, season_type_all_star=SEASON_TYPE, timeout=60
).get_dict()
games = rows_as_dicts(gl["resultSets"][0])
GAME_ID = games[len(games) // 2]["Game_ID"]
print(f"  using GAME_ID = {GAME_ID}\n")
time.sleep(1.5)

# ---- PRIMARY step 1: PlayByPlayV3 ----
print("PRIMARY step 1: PlayByPlayV3 ...")
pbp_rows = []
try:
    pbp = playbyplayv3.PlayByPlayV3(game_id=GAME_ID, timeout=60)
    d = pbp.get_dict()
    # V3 shape differs from V2. Inspect it rather than assuming.
    print(f"  top-level keys: {list(d.keys())}")
    # V3 typically: {'meta':..., 'game': {'gameId':..., 'actions': [ {...}, ... ]}}
    if "game" in d and "actions" in d["game"]:
        actions = d["game"]["actions"]
        pbp_rows = actions
        print(f"  actions: {len(actions)}")
        if actions:
            print(f"  sample action keys: {list(actions[0].keys())}")
            # show a couple of made-shot-ish actions with all fields
            for a in actions[:3]:
                print(f"    {json.dumps(a)[:300]}")
    else:
        # fall back to resultSets shape if present
        rs = d.get("resultSets") or []
        if rs:
            pbp_rows = rows_as_dicts(rs[0])
            print(f"  resultSets rows: {len(pbp_rows)}")
            print(f"  headers: {rs[0]['headers']}")
    dump("s2b_pbp_v3_sample.json", pbp_rows[:60])
except Exception as e:
    print(f"  V3 FAILED: {type(e).__name__}: {e}")

time.sleep(1.5)

# ---- PRIMARY step 2: shots for same game ----
print("\nPRIMARY step 2: shotchartdetail (same game) ...")
sc = shotchartdetail.ShotChartDetail(
    team_id=NETS_ID, player_id=0, game_id_nullable=GAME_ID,
    season_nullable=SEASON, season_type_all_star=SEASON_TYPE,
    context_measure_simple="FGA", timeout=60,
).get_dict()
shot_rows = rows_as_dicts(sc["resultSets"][0])
print(f"  Nets shots this game: {len(shot_rows)}")
made_shots = [s for s in shot_rows if s.get("SHOT_MADE_FLAG") == 1]
print(f"  made shots: {len(made_shots)}")
print(f"  sample GAME_EVENT_IDs (shots): {[s['GAME_EVENT_ID'] for s in made_shots[:10]]}")

time.sleep(1.5)

# ---- PRIMARY step 3: inspect V3 keys to find the event-number + assist fields ----
print("\nPRIMARY step 3: locate join key + assist field in V3 actions ...")
if pbp_rows and isinstance(pbp_rows[0], dict):
    keys = pbp_rows[0].keys()
    # candidate event-number fields in V3
    evnum_candidates = [k for k in keys if k.lower() in
                        ("actionnumber", "eventnum", "actionid", "number", "orderid")]
    assist_candidates = [k for k in keys if "assist" in k.lower()]
    print(f"  possible event-number keys: {evnum_candidates}")
    print(f"  possible assist keys: {assist_candidates}")
    print(f"  ALL V3 action keys: {list(keys)}")

    # Try the most likely join: shot.GAME_EVENT_ID <-> action['actionNumber']
    ev_key = evnum_candidates[0] if evnum_candidates else None
    if ev_key:
        pbp_by_ev = {a.get(ev_key): a for a in pbp_rows}
        joined = 0
        examples = []
        for s in made_shots:
            a = pbp_by_ev.get(s.get("GAME_EVENT_ID"))
            if not a:
                continue
            joined += 1
            # look for an assist-person field or a description mentioning assist
            assist_field = {k: a.get(k) for k in assist_candidates}
            desc = a.get("description") or ""
            examples.append({
                "shooter": s.get("PLAYER_NAME"),
                "loc": [s.get("LOC_X"), s.get("LOC_Y")],
                "event": s.get("GAME_EVENT_ID"),
                "assist_fields": assist_field,
                "desc": desc,
            })
        print(f"\n  made shots: {len(made_shots)} | joined via '{ev_key}': {joined}")
        print("  --- sample joined shots (look for assister) ---")
        for ex in examples[:8]:
            print(f"    {ex['shooter']} @ {ex['loc']} ev{ex['event']} "
                  f"| assist_fields={ex['assist_fields']} | {ex['desc'][:80]}")
        dump("s2b_JOINED.json", examples)
        if joined == 0:
            print("  >>> join key guess wrong — see ALL V3 action keys above.")
        else:
            print("  >>> JOIN WORKS. Check whether assist_fields/desc name the passer.")
    else:
        print("  no obvious event-number key — inspect ALL V3 action keys above.")
else:
    print("  no V3 rows to inspect (step 1 failed).")

time.sleep(1.5)

# ---- SECONDARY: Synergy (fixed param name) ----
print("\nSECONDARY: SynergyPlayTypes (Nets) ...")
try:
    syn = synergyplaytypes.SynergyPlayTypes(
        league_id="00",
        season=SEASON,
        season_type_all_star=SEASON_TYPE,
        per_mode_simple="Totals",
        player_or_team_abbreviation="T",
        type_grouping_nullable="offensive",   # was missing before
        timeout=60,
    ).get_dict()
    rs = syn["resultSets"][0]
    syn_rows = rows_as_dicts(rs)
    nets = [r for r in syn_rows if r.get("TEAM_ID") == NETS_ID]
    print(f"  Nets play-type rows: {len(nets)}")
    for r in nets:
        print(f"    {str(r.get('PLAY_TYPE')):>28} | PPP {r.get('PPP')} | "
              f"POSS {r.get('POSS')} | eFG {r.get('EFG_PCT')}")
    dump("s2b_synergy_nets.json", nets)
except Exception as e:
    print(f"  Synergy FAILED (non-blocking): {type(e).__name__}: {e}")

print("\nDONE. Paste the summary — esp. the ALL V3 action keys line and the join result.")
