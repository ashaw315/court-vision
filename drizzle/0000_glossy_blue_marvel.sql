CREATE TABLE "assist_edges" (
	"assister_id" integer NOT NULL,
	"shooter_id" integer NOT NULL,
	"count" integer NOT NULL,
	"points" integer NOT NULL,
	"made_2" integer NOT NULL,
	"made_3" integer NOT NULL,
	CONSTRAINT "assist_edges_assister_id_shooter_id_pk" PRIMARY KEY("assister_id","shooter_id")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"game_id" text PRIMARY KEY NOT NULL,
	"game_date" text,
	"matchup" text
);
--> statement-breakpoint
CREATE TABLE "lineup_intervals" (
	"interval_id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"period" smallint NOT NULL,
	"start_clock" text NOT NULL,
	"end_clock" text NOT NULL,
	"on_court" integer[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lineups" (
	"group_id" text PRIMARY KEY NOT NULL,
	"person_ids" integer[] NOT NULL,
	"minutes" double precision NOT NULL,
	"display_names" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"person_id" integer PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shot_events" (
	"game_id" text NOT NULL,
	"event_id" integer NOT NULL,
	"period" smallint NOT NULL,
	"clock" text NOT NULL,
	"shooter_id" integer NOT NULL,
	"loc_x" integer NOT NULL,
	"loc_y" integer NOT NULL,
	"shot_value" smallint NOT NULL,
	"shot_distance" real NOT NULL,
	"made" boolean NOT NULL,
	"assisted" boolean NOT NULL,
	"assister_id" integer,
	"action_type" text NOT NULL,
	"sub_type" text NOT NULL,
	"team_id" integer NOT NULL,
	"interval_id" text,
	CONSTRAINT "shot_events_game_id_event_id_pk" PRIMARY KEY("game_id","event_id")
);
--> statement-breakpoint
ALTER TABLE "assist_edges" ADD CONSTRAINT "assist_edges_assister_id_players_person_id_fk" FOREIGN KEY ("assister_id") REFERENCES "public"."players"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assist_edges" ADD CONSTRAINT "assist_edges_shooter_id_players_person_id_fk" FOREIGN KEY ("shooter_id") REFERENCES "public"."players"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineup_intervals" ADD CONSTRAINT "lineup_intervals_game_id_games_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("game_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_events" ADD CONSTRAINT "shot_events_game_id_games_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("game_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_events" ADD CONSTRAINT "shot_events_shooter_id_players_person_id_fk" FOREIGN KEY ("shooter_id") REFERENCES "public"."players"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_events" ADD CONSTRAINT "shot_events_assister_id_players_person_id_fk" FOREIGN KEY ("assister_id") REFERENCES "public"."players"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_events" ADD CONSTRAINT "shot_events_interval_id_lineup_intervals_interval_id_fk" FOREIGN KEY ("interval_id") REFERENCES "public"."lineup_intervals"("interval_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assist_edges_assister_idx" ON "assist_edges" USING btree ("assister_id");--> statement-breakpoint
CREATE INDEX "assist_edges_shooter_idx" ON "assist_edges" USING btree ("shooter_id");--> statement-breakpoint
CREATE INDEX "lineup_intervals_game_idx" ON "lineup_intervals" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "shot_events_shooter_idx" ON "shot_events" USING btree ("shooter_id");--> statement-breakpoint
CREATE INDEX "shot_events_interval_idx" ON "shot_events" USING btree ("interval_id");--> statement-breakpoint
CREATE INDEX "shot_events_game_idx" ON "shot_events" USING btree ("game_id");