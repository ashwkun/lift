-- Parent keys among the replicated tables, so a push that references a row this
-- server has never seen is rejected with `missing_parent` instead of being
-- accepted into a shape the device would refuse.
--
-- Every constraint is added NOT VALID, and deliberately not validated
-- afterwards. NOT VALID skips the scan of existing rows while still checking
-- every insert and update from here on, which is the half that matters: the
-- point is to stop new orphans, not to fail the boot over old ones. This
-- database predates the constraints, and any row whose parent push was retired
-- by the client is an orphan today. A plain ADD CONSTRAINT would abort the
-- migration on the first one, and `runMigrations()` runs before the server
-- listens, so a single legacy orphan would take the whole API down with no way
-- in to fix it. It also takes an ACCESS EXCLUSIVE lock for the length of a full
-- table scan of `workout_sets`, which is the largest table here.
--
-- `VALIDATE CONSTRAINT` can be run by hand later, once the orphans are counted
-- and dealt with. It takes a weaker lock and is safe to run against a live
-- server.

CREATE TABLE "sync_purge_watermarks" (
	"user_id" text PRIMARY KEY NOT NULL,
	"purged_through_seq" bigint DEFAULT 0 NOT NULL,
	"swept_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personal_records" ADD CONSTRAINT "personal_records_set_id_workout_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."workout_sets"("id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "personal_records" ADD CONSTRAINT "personal_records_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "routine_exercises" ADD CONSTRAINT "routine_exercises_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "routine_sets" ADD CONSTRAINT "routine_sets_routine_exercise_id_routine_exercises_id_fk" FOREIGN KEY ("routine_exercise_id") REFERENCES "public"."routine_exercises"("id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_folder_id_routine_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."routine_folders"("id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_workout_exercise_id_workout_exercises_id_fk" FOREIGN KEY ("workout_exercise_id") REFERENCES "public"."workout_exercises"("id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
CREATE INDEX "personal_records_set_idx" ON "personal_records" USING btree ("set_id");--> statement-breakpoint
CREATE INDEX "personal_records_workout_idx" ON "personal_records" USING btree ("workout_id");--> statement-breakpoint
CREATE INDEX "routine_exercises_routine_idx" ON "routine_exercises" USING btree ("routine_id");--> statement-breakpoint
CREATE INDEX "routine_sets_parent_idx" ON "routine_sets" USING btree ("routine_exercise_id");--> statement-breakpoint
CREATE INDEX "routines_folder_idx" ON "routines" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "workout_exercises_workout_idx" ON "workout_exercises" USING btree ("workout_id");--> statement-breakpoint
CREATE INDEX "workout_sets_parent_idx" ON "workout_sets" USING btree ("workout_exercise_id");--> statement-breakpoint
CREATE INDEX "workouts_routine_idx" ON "workouts" USING btree ("routine_id");