-- Hand-edited from the drizzle-kit output: the generated ADD COLUMN ... NOT NULL statements
-- cannot run against populated tables, so each new column is added nullable, backfilled from
-- the existing Nets 2025-26 data, then tightened. Constraint names for the old primary keys
-- were read from the live database.
CREATE TABLE "game_team_validation" (
	"game_id" text NOT NULL,
	"team_id" integer NOT NULL,
	"season" text NOT NULL,
	"passed" boolean NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "game_team_validation_game_id_team_id_pk" PRIMARY KEY("game_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "player_team_seasons" (
	"person_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"season" text NOT NULL,
	CONSTRAINT "player_team_seasons_person_id_team_id_season_pk" PRIMARY KEY("person_id","team_id","season")
);
--> statement-breakpoint
CREATE TABLE "team_seasons" (
	"season" text NOT NULL,
	"team_id" integer NOT NULL,
	"season_type" text DEFAULT 'Regular Season' NOT NULL,
	"games_scheduled" integer NOT NULL,
	"games_validated" integer NOT NULL,
	"games_excluded" integer NOT NULL,
	"last_loaded_at" timestamp with time zone,
	"failures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "team_seasons_season_team_id_pk" PRIMARY KEY("season","team_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"team_id" integer PRIMARY KEY NOT NULL,
	"abbreviation" text NOT NULL,
	"city" text NOT NULL,
	"name" text NOT NULL,
	"conference" text NOT NULL,
	"division" text NOT NULL,
	CONSTRAINT "teams_abbreviation_unique" UNIQUE("abbreviation")
);
--> statement-breakpoint
INSERT INTO "teams" ("team_id", "abbreviation", "city", "name", "conference", "division") VALUES
  (1610612737, 'ATL', 'Atlanta', 'Hawks', 'East', 'Southeast'),
  (1610612751, 'BKN', 'Brooklyn', 'Nets', 'East', 'Atlantic'),
  (1610612738, 'BOS', 'Boston', 'Celtics', 'East', 'Atlantic'),
  (1610612766, 'CHA', 'Charlotte', 'Hornets', 'East', 'Southeast'),
  (1610612741, 'CHI', 'Chicago', 'Bulls', 'East', 'Central'),
  (1610612739, 'CLE', 'Cleveland', 'Cavaliers', 'East', 'Central'),
  (1610612742, 'DAL', 'Dallas', 'Mavericks', 'West', 'Southwest'),
  (1610612743, 'DEN', 'Denver', 'Nuggets', 'West', 'Northwest'),
  (1610612765, 'DET', 'Detroit', 'Pistons', 'East', 'Central'),
  (1610612744, 'GSW', 'San Francisco', 'Warriors', 'West', 'Pacific'),
  (1610612745, 'HOU', 'Houston', 'Rockets', 'West', 'Southwest'),
  (1610612754, 'IND', 'Indiana', 'Pacers', 'East', 'Central'),
  (1610612746, 'LAC', 'Los Angeles', 'Clippers', 'West', 'Pacific'),
  (1610612747, 'LAL', 'Los Angeles', 'Lakers', 'West', 'Pacific'),
  (1610612763, 'MEM', 'Memphis', 'Grizzlies', 'West', 'Southwest'),
  (1610612748, 'MIA', 'Miami', 'Heat', 'East', 'Southeast'),
  (1610612749, 'MIL', 'Milwaukee', 'Bucks', 'East', 'Central'),
  (1610612750, 'MIN', 'Minnesota', 'Timberwolves', 'West', 'Northwest'),
  (1610612740, 'NOP', 'New Orleans', 'Pelicans', 'West', 'Southwest'),
  (1610612752, 'NYK', 'New York', 'Knicks', 'East', 'Atlantic'),
  (1610612760, 'OKC', 'Oklahoma City', 'Thunder', 'West', 'Northwest'),
  (1610612753, 'ORL', 'Orlando', 'Magic', 'East', 'Southeast'),
  (1610612755, 'PHI', 'Philadelphia', '76ers', 'East', 'Atlantic'),
  (1610612756, 'PHX', 'Phoenix', 'Suns', 'West', 'Pacific'),
  (1610612757, 'POR', 'Portland', 'Trail Blazers', 'West', 'Northwest'),
  (1610612758, 'SAC', 'Sacramento', 'Kings', 'West', 'Pacific'),
  (1610612759, 'SAS', 'San Antonio', 'Spurs', 'West', 'Southwest'),
  (1610612761, 'TOR', 'Toronto', 'Raptors', 'East', 'Atlantic'),
  (1610612762, 'UTA', 'Utah', 'Jazz', 'West', 'Northwest'),
  (1610612764, 'WAS', 'Washington', 'Wizards', 'East', 'Southeast');
--> statement-breakpoint
-- ---- new columns, nullable first ----
ALTER TABLE "games" ADD COLUMN "season" text;
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "played_on" date;
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "home_team_id" integer;
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "away_team_id" integer;
--> statement-breakpoint
ALTER TABLE "lineups" ADD COLUMN "season" text;
--> statement-breakpoint
ALTER TABLE "lineups" ADD COLUMN "team_id" integer;
--> statement-breakpoint
ALTER TABLE "lineup_intervals" ADD COLUMN "season" text;
--> statement-breakpoint
ALTER TABLE "lineup_intervals" ADD COLUMN "team_id" integer;
--> statement-breakpoint
ALTER TABLE "lineup_intervals" ADD COLUMN "duration_seconds" double precision;
--> statement-breakpoint
ALTER TABLE "shot_events" ADD COLUMN "season" text;
--> statement-breakpoint
ALTER TABLE "assist_edges" ADD COLUMN "season" text;
--> statement-breakpoint
ALTER TABLE "assist_edges" ADD COLUMN "team_id" integer;
--> statement-breakpoint
-- ---- backfill: everything pre-existing is Brooklyn, 2025-26 regular season ----
UPDATE "games" g SET
  "season" = '2025-26',
  "played_on" = to_date(g."game_date", 'MON DD, YYYY'),
  "home_team_id" = CASE WHEN split_part(g."matchup", ' ', 2) = 'vs.'
    THEN 1610612751
    ELSE (SELECT t."team_id" FROM "teams" t WHERE t."abbreviation" = split_part(g."matchup", ' ', 3)) END,
  "away_team_id" = CASE WHEN split_part(g."matchup", ' ', 2) = '@'
    THEN 1610612751
    ELSE (SELECT t."team_id" FROM "teams" t WHERE t."abbreviation" = split_part(g."matchup", ' ', 3)) END;
--> statement-breakpoint
UPDATE "lineups" SET "season" = '2025-26', "team_id" = 1610612751;
--> statement-breakpoint
UPDATE "lineup_intervals" SET
  "season" = '2025-26',
  "team_id" = split_part("interval_id", ':', 2)::integer,
  "duration_seconds" =
      (substring("start_clock" from 'PT(\d+)M')::integer * 60 + substring("start_clock" from 'M([0-9.]+)S')::double precision)
    - (substring("end_clock" from 'PT(\d+)M')::integer * 60 + substring("end_clock" from 'M([0-9.]+)S')::double precision);
--> statement-breakpoint
UPDATE "shot_events" SET "season" = '2025-26';
--> statement-breakpoint
UPDATE "assist_edges" SET "season" = '2025-26', "team_id" = 1610612751;
--> statement-breakpoint
-- ---- tighten ----
ALTER TABLE "games" ALTER COLUMN "season" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "games" ALTER COLUMN "home_team_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "games" ALTER COLUMN "away_team_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "lineups" ALTER COLUMN "season" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "lineups" ALTER COLUMN "team_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "lineup_intervals" ALTER COLUMN "season" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "lineup_intervals" ALTER COLUMN "team_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "lineup_intervals" ALTER COLUMN "duration_seconds" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "shot_events" ALTER COLUMN "season" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "assist_edges" ALTER COLUMN "season" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "assist_edges" ALTER COLUMN "team_id" SET NOT NULL;
--> statement-breakpoint
-- ---- primary keys now include season + team ----
ALTER TABLE "assist_edges" DROP CONSTRAINT "assist_edges_assister_id_shooter_id_pk";
--> statement-breakpoint
ALTER TABLE "assist_edges" ADD CONSTRAINT "assist_edges_season_team_id_assister_id_shooter_id_pk" PRIMARY KEY("season","team_id","assister_id","shooter_id");
--> statement-breakpoint
ALTER TABLE "lineups" DROP CONSTRAINT "lineups_pkey";
--> statement-breakpoint
ALTER TABLE "lineups" ADD CONSTRAINT "lineups_season_team_id_group_id_pk" PRIMARY KEY("season","team_id","group_id");
--> statement-breakpoint
-- ---- Brooklyn's team-season, validation audit and roster ----
INSERT INTO "team_seasons" ("season","team_id","games_scheduled","games_validated","games_excluded","last_loaded_at")
SELECT '2025-26', 1610612751, count(*), count(*), 0, now() FROM "games";
--> statement-breakpoint
INSERT INTO "game_team_validation" ("game_id","team_id","season","passed","reasons")
SELECT "game_id", 1610612751, '2025-26', true, '[]'::jsonb FROM "games";
--> statement-breakpoint
INSERT INTO "player_team_seasons" ("person_id","team_id","season")
SELECT "person_id", 1610612751, '2025-26' FROM "players";
--> statement-breakpoint
ALTER TABLE "game_team_validation" ADD CONSTRAINT "game_team_validation_game_id_games_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("game_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "game_team_validation" ADD CONSTRAINT "game_team_validation_team_id_teams_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("team_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "player_team_seasons" ADD CONSTRAINT "player_team_seasons_person_id_players_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."players"("person_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "player_team_seasons" ADD CONSTRAINT "player_team_seasons_team_id_teams_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("team_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "team_seasons" ADD CONSTRAINT "team_seasons_team_id_teams_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("team_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assist_edges" ADD CONSTRAINT "assist_edges_team_id_teams_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("team_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_home_team_id_teams_team_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("team_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_away_team_id_teams_team_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("team_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "lineup_intervals" ADD CONSTRAINT "lineup_intervals_team_id_teams_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("team_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "lineups" ADD CONSTRAINT "lineups_team_id_teams_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("team_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shot_events" ADD CONSTRAINT "shot_events_team_id_teams_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("team_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "game_team_validation_team_idx" ON "game_team_validation" USING btree ("season","team_id");
--> statement-breakpoint
CREATE INDEX "player_team_seasons_team_idx" ON "player_team_seasons" USING btree ("season","team_id");
--> statement-breakpoint
CREATE INDEX "games_season_idx" ON "games" USING btree ("season");
--> statement-breakpoint
CREATE INDEX "games_home_idx" ON "games" USING btree ("season","home_team_id");
--> statement-breakpoint
CREATE INDEX "games_away_idx" ON "games" USING btree ("season","away_team_id");
--> statement-breakpoint
CREATE INDEX "lineup_intervals_team_idx" ON "lineup_intervals" USING btree ("season","team_id");
--> statement-breakpoint
CREATE INDEX "shot_events_team_season_idx" ON "shot_events" USING btree ("season","team_id");
--> statement-breakpoint
CREATE INDEX "shot_events_team_season_shooter_idx" ON "shot_events" USING btree ("season","team_id","shooter_id");
