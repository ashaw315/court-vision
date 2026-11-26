"""fold_league_gamelog: team-game rows -> one record per game, home/away from the source."""

import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from nba_client import fold_league_gamelog  # noqa: E402

HEADERS = ["GAME_ID", "GAME_DATE", "TEAM_ID", "TEAM_ABBREVIATION", "MATCHUP"]


def payload(rows):
    return {"resultSets": [{"headers": HEADERS, "rowSet": rows}]}


def test_folds_two_rows_into_one_game_with_home_and_away():
    games = fold_league_gamelog(payload([
        ["002", "2025-11-14", 1610612753, "ORL", "ORL vs. BKN"],
        ["002", "2025-11-14", 1610612751, "BKN", "BKN @ ORL"],
        ["001", "2025-11-07", 1610612751, "BKN", "BKN vs. DET"],
        ["001", "2025-11-07", 1610612765, "DET", "DET @ BKN"],
    ]))
    assert [g["gameId"] for g in games] == ["001", "002"]  # oldest first
    assert games[0]["homeTeamId"] == 1610612751 and games[0]["awayTeamId"] == 1610612765
    assert games[1]["homeTeamId"] == 1610612753 and games[1]["awayTeamId"] == 1610612751
    assert games[1]["sides"][1610612751]["abbreviation"] == "BKN"


def test_game_missing_a_side_is_an_error_not_a_guess():
    with pytest.raises(ValueError, match="one home and one away"):
        fold_league_gamelog(payload([["001", "2025-11-07", 1610612751, "BKN", "BKN vs. DET"]]))
