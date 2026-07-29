"""
THROWAWAY SPIKE — not production code. Run locally (NBA endpoints 403 in cloud).

Goal: answer three questions before we model anything.
  Q1. Do shot coordinates pull for the Nets (2025-26)?  -> shape of spatial data
  Q2. Does passing-network data pull for a Nets player?  -> shape of relational data
  Q3. How many Nets 5-man lineups cleared a real minutes threshold?
      -> decides whether "lineup vs lineup" is viable as-is

Setup:
    pip install nba_api
    python spike.py

It writes raw JSON samples to ./spike_out/ so we can eyeball real shapes,
and prints a summary to the terminal. Paste the terminal summary back to me.
"""

import json
import os
import time
from nba_api.stats.static import teams
from nba_api.stats.endpoints import (
    shotchartdetail,
    teamdashlineups,
    commonteamroster,
    playerdashptpass,
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


# ---------- Q1: SHOT COORDINATES ----------
print("Q1: Nets shot coordinates ...")
try:
    sc = shotchartdetail.ShotChartDetail(
        team_id=NETS_ID,
        player_id=0,
        season_nullable=SEASON,
        season_type_all_star=SEASON_TYPE,
        context_measure_simple="FGA",
        timeout=60,
    ).get_dict()
    rs = sc["resultSets"][0]
    hdr, rows = rs["headers"], rs["rowSet"]
    print(f"  headers: {hdr}")
    print(f"  total shots: {len(rows)}")
    if rows:
        # LOC_X / LOC_Y are the spatial fields; show one row mapped to headers
        sample = dict(zip(hdr, rows[0]))
        keep = {k: sample[k] for k in hdr if k in (
            "PLAYER_NAME", "LOC_X", "LOC_Y", "SHOT_MADE_FLAG",
            "SHOT_TYPE", "ACTION_TYPE", "SHOT_ZONE_BASIC", "GAME_ID"
        )}
        print(f"  sample shot: {keep}")
    dump("q1_shots_sample.json", {"headers": hdr, "rows": rows[:25]})
except Exception as e:
    print(f"  Q1 FAILED: {type(e).__name__}: {e}")

time.sleep(1.5)

# ---------- Q3: LINEUPS + MINUTES ----------
# Done before Q2 because it tells us which players anchor real lineups.
print("\nQ3: Nets 5-man lineups by minutes ...")
try:
    lu = teamdashlineups.TeamDashLineups(
        team_id=NETS_ID,
        season=SEASON,
        season_type_all_star=SEASON_TYPE,
        group_quantity=5,
        timeout=60,
    ).get_dict()
    # resultSets: [0]=Overall, [1]=Lineups
    lineups_set = lu["resultSets"][1]
    hdr, rows = lineups_set["headers"], lineups_set["rowSet"]
    idx = {h: i for i, h in enumerate(hdr)}
    min_i = idx.get("MIN")
    name_i = idx.get("GROUP_NAME")
    rows_sorted = sorted(rows, key=lambda r: r[min_i], reverse=True)
    for thresh in (100, 50, 25):
        n = sum(1 for r in rows_sorted if r[min_i] >= thresh)
        print(f"  lineups >= {thresh} min: {n}")
    print(f"  total distinct 5-man lineups: {len(rows)}")
    print("  top 5 by minutes:")
    for r in rows_sorted[:5]:
        print(f"    {r[min_i]:6.1f} min  |  {r[name_i]}")
    dump("q3_lineups.json", {"headers": hdr, "rows": rows_sorted[:40]})
except Exception as e:
    print(f"  Q3 FAILED: {type(e).__name__}: {e}")

time.sleep(1.5)

# ---------- Q2: PASSING NETWORK ----------
# Passing is per-PLAYER (passes made/received), not per-lineup. This is the
# key shape check: we need to see whether we can assemble a lineup's network
# from individual players' pass data.
print("\nQ2: passing network for one Nets player ...")
try:
    roster = commonteamroster.CommonTeamRoster(
        team_id=NETS_ID, season=SEASON, timeout=60
    ).get_dict()
    r_rs = roster["resultSets"][0]
    r_idx = {h: i for i, h in enumerate(r_rs["headers"])}
    # pick the roster player (proxy for high-usage: first listed; we'll refine later)
    player = r_rs["rowSet"][0]
    pid = player[r_idx["PLAYER_ID"]]
    pname = player[r_idx["PLAYER"]]
    print(f"  using player: {pname} ({pid})")

    pas = playerdashptpass.PlayerDashPtPass(
        player_id=pid,
        team_id=NETS_ID,
        season=SEASON,
        season_type_all_star=SEASON_TYPE,
        timeout=60,
    ).get_dict()
    # resultSets: PassesMade, PassesReceived
    for s in pas["resultSets"]:
        hdr, rows = s["headers"], s["rowSet"]
        print(f"  [{s['name']}] rows={len(rows)} headers={hdr}")
        if rows:
            print(f"    sample: {dict(zip(hdr, rows[0]))}")
        dump(f"q2_{s['name']}.json", {"headers": hdr, "rows": rows[:25]})
except Exception as e:
    print(f"  Q2 FAILED: {type(e).__name__}: {e}")

print("\nDONE. Paste the terminal summary back. Raw JSON is in ./spike_out/")
