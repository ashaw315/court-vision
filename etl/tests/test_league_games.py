"""fold_league_gamelog: team-game rows -> one record per game, home/away from the source."""

import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from nba_client import fold_league_gamelog, resolve_neutral_site  # noqa: E402

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


# Neutral-site games (international games, NBA Cup knockout rounds in Las Vegas) list BOTH
# sides as "X @ Y" in the league game log — five such games in 2025-26 (e.g. 0022500147,
# DET/DAL in Mexico City). The game log does not say who the designated home team is, so
# the fold leaves it unset and the boxscore supplies it.

NEUTRAL = [
    ["003", "2025-11-01", 1610612765, "DET", "DET @ DAL"],
    ["003", "2025-11-01", 1610612742, "DAL", "DAL @ DET"],
]


def test_neutral_site_game_is_folded_without_inventing_home_and_away():
    [game] = fold_league_gamelog(payload(NEUTRAL))
    assert game["neutralSite"] is True
    assert game["homeTeamId"] is None and game["awayTeamId"] is None
    assert set(game["sides"]) == {1610612765, 1610612742}


def test_regular_game_is_not_neutral_site():
    [game] = fold_league_gamelog(payload([
        ["001", "2025-11-07", 1610612751, "BKN", "BKN vs. DET"],
        ["001", "2025-11-07", 1610612765, "DET", "DET @ BKN"],
    ]))
    assert game["neutralSite"] is False


def test_two_home_sides_is_still_an_error():
    with pytest.raises(ValueError, match="one home and one away"):
        fold_league_gamelog(payload([
            ["001", "2025-11-07", 1610612751, "BKN", "BKN vs. DET"],
            ["001", "2025-11-07", 1610612765, "DET", "DET vs. BKN"],
        ]))


def boxscore(home, away):
    return {"boxScoreTraditional": {"gameId": "003", "homeTeamId": home, "awayTeamId": away}}


def test_neutral_site_home_and_away_come_from_the_boxscore():
    [game] = fold_league_gamelog(payload(NEUTRAL))
    resolved = resolve_neutral_site(game, boxscore(1610612742, 1610612765))
    assert resolved["homeTeamId"] == 1610612742 and resolved["awayTeamId"] == 1610612765
    assert resolved["neutralSite"] is True
    assert game["homeTeamId"] is None  # input untouched


def test_boxscore_naming_other_teams_is_an_error_not_a_guess():
    [game] = fold_league_gamelog(payload(NEUTRAL))
    with pytest.raises(ValueError, match="boxscore"):
        resolve_neutral_site(game, boxscore(1610612751, 1610612765))


def test_boxscore_without_designation_is_an_error():
    [game] = fold_league_gamelog(payload(NEUTRAL))
    with pytest.raises(ValueError, match="boxscore"):
        resolve_neutral_site(game, {"boxScoreTraditional": {"gameId": "003"}})
