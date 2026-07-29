"""
SPIKE 2 — THROWAWAY. Run locally (NBA endpoints 403 from cloud IPs).

Two questions, in priority order:

  PRIMARY (the concept depends on this):
    Can we join playbyplayv2 to shotchartdetail and produce a MADE, ASSISTED shot
    with BOTH its real court location AND the assisting player's ID?
    -> If yes, the fused assist-network + shot-map view is real, not invented.

  SECONDARY (enrichment, only matters if primary works):
    What does SynergyPlayTypes look like for the Nets? Is the play-type fingerprint
    (transition / iso / P&R / spot-up / etc.) rich enough to be a future layer?

Setup:
    source .venv/bin/activate      # the venv you already made
    python spike2.py

Writes raw samples to ./spike_out/ and prints a summary. Paste the summary back.
"""

import json
import os
import time
from nba_api.stats.static import teams
from nba_api.stats.endpoints import (
    teamgamelog,
    playbyplayv2,
    shotchartdetail,
    synergyplaytypes,
)

SEASON = "2025-26"
SEASON_TYPE = "Regular Season"
OUT = "spike_out"
os.makedirs(OUT, exist_ok=True)

NETS_ID = [t for t in teams.get_teams() if t["abbreviation"] == "BKN"][0]["id"]
print(f"Nets team_id = {NETS_ID}\n")


def dump(name, obj):
    path = os.path.join(OUT, name)
    with open(path, "w") as f:
        json.dump(obj, f, indent=2)
    print(f"  wrote {path}")


def rows_as_dicts(result_set):
    hdr = result_set["headers"]
    return [dict(zip(hdr, r)) for r in result_set["rowSet"]]


# ---------- pick one Nets game ----------
print("Finding one Nets game id ...")
GAME_ID = None
try:
    gl = teamgamelog.TeamGameLog(
        team_id=NETS_ID, season=SEASON, season_type_all_star=SEASON_TYPE, timeout=60
    ).get_dict()
    games = rows_as_dicts(gl["resultSets"][0])
    # take a mid-season game (avoid game 1 oddities)
    GAME_ID = games[len(games) // 2]["Game_ID"]
    print(f"  using GAME_ID = {GAME_ID}\n")
except Exception as e:
    print(f"  FAILED to get game list: {type(e).__name__}: {e}")
    raise SystemExit(1)

time.sleep(1.5)

# ---------- PRIMARY: play-by-play ----------
print("PRIMARY step 1: playbyplayv2 for that game ...")
pbp_rows = []
try:
    pbp = playbyplayv2.PlayByPlayV2(game_id=GAME_ID, timeout=60).get_dict()
    pbp_set = pbp["resultSets"][0]
    pbp_rows = rows_as_dicts(pbp_set)
    print(f"  headers: {pbp_set['headers']}")
    print(f"  total events: {len(pbp_rows)}")
    # EVENTMSGTYPE 1 == made shot. Show one made-shot event with its description,
    # because the assisting player is embedded in the description text, not a column.
    made = [r for r in pbp_rows if r.get("EVENTMSGTYPE") == 1]
    print(f"  made-shot events: {len(made)}")
    if made:
        ex = made[0]
        print("  sample made-shot event keys we care about:")
        for k in ("GAME_ID", "EVENTNUM", "EVENTMSGTYPE", "EVENTMSGACTIONTYPE",
                  "PERIOD", "PCTIMESTRING", "PLAYER1_ID", "PLAYER1_NAME",
                  "PLAYER2_ID", "PLAYER2_NAME", "HOMEDESCRIPTION",
                  "VISITORDESCRIPTION"):
            print(f"    {k}: {ex.get(k)}")
    dump("s2_pbp_sample.json", {"headers": pbp_set["headers"], "rows": pbp_rows[:60]})
except Exception as e:
    print(f"  PRIMARY pbp FAILED: {type(e).__name__}: {e}")

time.sleep(1.5)

# ---------- PRIMARY: shot chart for same game ----------
print("\nPRIMARY step 2: shotchartdetail for the SAME game ...")
shot_rows = []
try:
    sc = shotchartdetail.ShotChartDetail(
        team_id=NETS_ID,
        player_id=0,
        game_id_nullable=GAME_ID,
        season_nullable=SEASON,
        season_type_all_star=SEASON_TYPE,
        context_measure_simple="FGA",
        timeout=60,
    ).get_dict()
    sc_set = sc["resultSets"][0]
    shot_rows = rows_as_dicts(sc_set)
    print(f"  headers: {sc_set['headers']}")
    print(f"  shots in this game (Nets): {len(shot_rows)}")
    if shot_rows:
        ex = shot_rows[0]
        print("  sample shot join-keys:")
        for k in ("GAME_ID", "GAME_EVENT_ID", "PLAYER_ID", "PLAYER_NAME",
                  "LOC_X", "LOC_Y", "SHOT_MADE_FLAG"):
            print(f"    {k}: {ex.get(k)}")
    dump("s2_shots_game.json", {"headers": sc_set["headers"], "rows": shot_rows[:60]})
except Exception as e:
    print(f"  PRIMARY shotchart FAILED: {type(e).__name__}: {e}")

# ---------- PRIMARY: THE ACTUAL JOIN ----------
# This is the whole point. shotchartdetail.GAME_EVENT_ID should correspond to
# playbyplayv2.EVENTNUM for the same GAME_ID. If that holds, we can attach the
# play-by-play event (which names the assister) to the located shot.
print("\nPRIMARY step 3: THE JOIN (shot.GAME_EVENT_ID <-> pbp.EVENTNUM) ...")
try:
    pbp_by_event = {r["EVENTNUM"]: r for r in pbp_rows}
    made_shots = [s for s in shot_rows if s.get("SHOT_MADE_FLAG") == 1]
    joined = 0
    assisted_examples = []
    for s in made_shots:
        ev = s.get("GAME_EVENT_ID")
        p = pbp_by_event.get(ev)
        if not p:
            continue
        joined += 1
        # PLAYER2 on a made-shot pbp row is typically the assister (when present).
        assister_id = p.get("PLAYER2_ID")
        assister_name = p.get("PLAYER2_NAME")
        desc = p.get("HOMEDESCRIPTION") or p.get("VISITORDESCRIPTION") or ""
        if assister_id and assister_id != 0 and ("AST" in desc.upper() or assister_name):
            assisted_examples.append({
                "shooter": s.get("PLAYER_NAME"),
                "loc": [s.get("LOC_X"), s.get("LOC_Y")],
                "made": s.get("SHOT_MADE_FLAG"),
                "event": ev,
                "assister_id": assister_id,
                "assister_name": assister_name,
                "pbp_desc": desc,
            })
    print(f"  made shots: {len(made_shots)} | joined to a pbp event: {joined}")
    print(f"  of those, assisted (have a passer): {len(assisted_examples)}")
    print("  --- sample assisted, located shots (THE THING WE WANT) ---")
    for a in assisted_examples[:8]:
        print(f"    {a['shooter']} @ ({a['loc'][0]},{a['loc'][1]}) "
              f"<- assist {a['assister_name']} ({a['assister_id']})  | {a['pbp_desc']}")
    dump("s2_JOINED_assisted_located.json", assisted_examples)
    if joined == 0:
        print("  >>> JOIN FAILED: GAME_EVENT_ID did not match EVENTNUM. "
              "Concept needs rethink — tell Claude.")
    elif len(assisted_examples) == 0:
        print("  >>> Joined but found no assisters — check description parsing.")
    else:
        print("  >>> JOIN WORKS. Fused assist->located-shot is real.")
except Exception as e:
    print(f"  JOIN step FAILED: {type(e).__name__}: {e}")

time.sleep(1.5)

# ---------- SECONDARY: Synergy play types ----------
print("\nSECONDARY: SynergyPlayTypes for the Nets (offensive fingerprint) ...")
try:
    syn = synergyplaytypes.SynergyPlayTypes(
        league_id="00",
        season=SEASON,
        season_type_all_star=SEASON_TYPE,
        per_mode_simple="Totals",
        player_or_team_abbreviation="T",  # team-level
        timeout=60,
    ).get_dict()
    syn_set = syn["resultSets"][0] if "resultSets" in syn else syn["data_sets"][0]
    syn_rows = rows_as_dicts(syn_set) if "headers" in syn_set else []
    # filter to Nets
    nets_syn = [r for r in syn_rows if r.get("TEAM_ID") == NETS_ID]
    print(f"  play-type rows for Nets: {len(nets_syn)}")
    for r in nets_syn:
        print(f"    {r.get('PLAY_TYPE'):>28} | PPP {r.get('PPP')} | "
              f"POSS {r.get('POSS')} | eFG {r.get('EFG_PCT')} | pct {r.get('PERCENTILE')}")
    dump("s2_synergy_nets.json", nets_syn)
except Exception as e:
    print(f"  SECONDARY synergy FAILED (non-blocking): {type(e).__name__}: {e}")

print("\nDONE. Paste the summary back — especially the PRIMARY step-3 result.")
