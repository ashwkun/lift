CREATE SEQUENCE "public"."sync_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "body_measurements" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"value" double precision NOT NULL,
	"measured_at" bigint NOT NULL,
	"notes" text,
	"user_id" text NOT NULL,
	"updated_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"deleted_at" bigint,
	"seq" bigint DEFAULT nextval('sync_seq') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"equipment" text NOT NULL,
	"primary_muscle" text NOT NULL,
	"secondary_muscles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tracking_type" text NOT NULL,
	"is_custom" boolean DEFAULT true NOT NULL,
	"notes" text,
	"image_url" text,
	"is_archived" boolean DEFAULT false NOT NULL,
	"default_rest_seconds" integer,
	"user_id" text NOT NULL,
	"updated_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"deleted_at" bigint,
	"seq" bigint DEFAULT nextval('sync_seq') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personal_records" (
	"id" text PRIMARY KEY NOT NULL,
	"exercise_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" double precision NOT NULL,
	"reps" integer,
	"set_id" text,
	"workout_id" text,
	"achieved_at" bigint NOT NULL,
	"user_id" text NOT NULL,
	"updated_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"deleted_at" bigint,
	"seq" bigint DEFAULT nextval('sync_seq') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routine_exercises" (
	"id" text PRIMARY KEY NOT NULL,
	"routine_id" text NOT NULL,
	"exercise_id" text NOT NULL,
	"position" double precision DEFAULT 0 NOT NULL,
	"notes" text,
	"rest_seconds" integer,
	"superset_group" integer,
	"user_id" text NOT NULL,
	"updated_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"deleted_at" bigint,
	"seq" bigint DEFAULT nextval('sync_seq') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routine_folders" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"position" double precision DEFAULT 0 NOT NULL,
	"user_id" text NOT NULL,
	"updated_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"deleted_at" bigint,
	"seq" bigint DEFAULT nextval('sync_seq') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routine_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"routine_exercise_id" text NOT NULL,
	"position" double precision DEFAULT 0 NOT NULL,
	"set_type" text DEFAULT 'normal' NOT NULL,
	"target_reps" integer,
	"target_weight_kg" double precision,
	"target_duration_seconds" integer,
	"target_distance_km" double precision,
	"target_rpe" double precision,
	"user_id" text NOT NULL,
	"updated_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"deleted_at" bigint,
	"seq" bigint DEFAULT nextval('sync_seq') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routines" (
	"id" text PRIMARY KEY NOT NULL,
	"folder_id" text,
	"name" text NOT NULL,
	"notes" text,
	"position" double precision DEFAULT 0 NOT NULL,
	"last_performed_at" bigint,
	"user_id" text NOT NULL,
	"updated_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"deleted_at" bigint,
	"seq" bigint DEFAULT nextval('sync_seq') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sync_receipts" (
	"user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"client_seq" bigint NOT NULL,
	"applied_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_exercises" (
	"id" text PRIMARY KEY NOT NULL,
	"workout_id" text NOT NULL,
	"exercise_id" text NOT NULL,
	"position" double precision DEFAULT 0 NOT NULL,
	"notes" text,
	"rest_seconds" integer,
	"superset_group" integer,
	"user_id" text NOT NULL,
	"updated_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"deleted_at" bigint,
	"seq" bigint DEFAULT nextval('sync_seq') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workout_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"workout_exercise_id" text NOT NULL,
	"position" double precision DEFAULT 0 NOT NULL,
	"set_type" text DEFAULT 'normal' NOT NULL,
	"weight_kg" double precision,
	"reps" integer,
	"duration_seconds" integer,
	"distance_km" double precision,
	"rpe" double precision,
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_at" bigint,
	"user_id" text NOT NULL,
	"updated_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"deleted_at" bigint,
	"seq" bigint DEFAULT nextval('sync_seq') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" text PRIMARY KEY NOT NULL,
	"routine_id" text,
	"name" text NOT NULL,
	"notes" text,
	"started_at" bigint NOT NULL,
	"finished_at" bigint,
	"duration_seconds" integer,
	"total_volume_kg" double precision DEFAULT 0 NOT NULL,
	"total_sets" integer DEFAULT 0 NOT NULL,
	"total_reps" integer DEFAULT 0 NOT NULL,
	"pr_count" integer DEFAULT 0 NOT NULL,
	"user_id" text NOT NULL,
	"updated_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"deleted_at" bigint,
	"seq" bigint DEFAULT nextval('sync_seq') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "body_measurements_sync_idx" ON "body_measurements" USING btree ("user_id","seq");--> statement-breakpoint
CREATE INDEX "exercises_sync_idx" ON "exercises" USING btree ("user_id","seq");--> statement-breakpoint
CREATE INDEX "personal_records_sync_idx" ON "personal_records" USING btree ("user_id","seq");--> statement-breakpoint
CREATE INDEX "routine_exercises_sync_idx" ON "routine_exercises" USING btree ("user_id","seq");--> statement-breakpoint
CREATE INDEX "routine_folders_sync_idx" ON "routine_folders" USING btree ("user_id","seq");--> statement-breakpoint
CREATE INDEX "routine_sets_sync_idx" ON "routine_sets" USING btree ("user_id","seq");--> statement-breakpoint
CREATE INDEX "routines_sync_idx" ON "routines" USING btree ("user_id","seq");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_receipts_pk" ON "sync_receipts" USING btree ("user_id","device_id","client_seq");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "workout_exercises_sync_idx" ON "workout_exercises" USING btree ("user_id","seq");--> statement-breakpoint
CREATE INDEX "workout_sets_sync_idx" ON "workout_sets" USING btree ("user_id","seq");--> statement-breakpoint
CREATE INDEX "workouts_sync_idx" ON "workouts" USING btree ("user_id","seq");--> statement-breakpoint
CREATE INDEX "workouts_started_idx" ON "workouts" USING btree ("user_id","started_at");