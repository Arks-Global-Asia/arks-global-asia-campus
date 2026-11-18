-- PostgreSQL initial schema; run explicitly, never from HTTP requests.

CREATE SCHEMA IF NOT EXISTS "arks";

CREATE TABLE IF NOT EXISTS "arks"."access_groups" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "google_group" TEXT NOT NULL DEFAULT '',
  "batch_id" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "arks"."admin_credentials" (
  "user_id" TEXT NOT NULL,
  "salt" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  PRIMARY KEY ("user_id")
);

CREATE TABLE IF NOT EXISTS "arks"."attempts" (
  "id" TEXT NOT NULL,
  "test_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "started" TEXT NOT NULL,
  "submitted" TEXT,
  "answers" TEXT,
  "score" NUMERIC(10,2),
  "total" NUMERIC(10,2),
  "snapshot" TEXT NOT NULL,
  "feedback" TEXT,
  "grading_status" TEXT NOT NULL DEFAULT 'complete',
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "arks"."audit" (
  "id" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "created" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "arks"."auth_identities" (
  "id" TEXT NOT NULL,
  "issuer" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "arks"."auth_limits" (
  "id" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "reset_at" BIGINT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "arks"."auth_sessions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "expires" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "arks"."auth_states" (
  "id" TEXT NOT NULL,
  "verifier" TEXT NOT NULL,
  "expires" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "arks"."automation_sources" (
  "id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "folder_input" TEXT NOT NULL,
  "folder_id" TEXT,
  "folder_name" TEXT,
  "enabled" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "last_sync" TEXT,
  "last_error" TEXT,
  "sync_requested" INTEGER NOT NULL DEFAULT 1,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "created" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "arks"."batches" (
  "id" TEXT NOT NULL,
  "course_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "start_date" TEXT NOT NULL,
  "end_date" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  "covered" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active',
  "config" TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "arks"."completions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "content_id" TEXT NOT NULL,
  "created" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "arks"."content" (
  "id" TEXT NOT NULL,
  "course_id" TEXT NOT NULL,
  "batch_id" TEXT,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "topic_order" INTEGER NOT NULL DEFAULT 1,
  "body" TEXT NOT NULL DEFAULT '',
  "url" TEXT NOT NULL DEFAULT '',
  "starts_at" TEXT NOT NULL DEFAULT '',
  "duration" INTEGER NOT NULL DEFAULT 60,
  "file_id" TEXT,
  "published" INTEGER NOT NULL DEFAULT 1,
  "created" TEXT NOT NULL,
  "session_status" TEXT NOT NULL DEFAULT 'scheduled',
  "series_id" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "arks"."courses" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "syllabus" TEXT NOT NULL,
  "fee" BIGINT NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "arks"."engine_jobs" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "batch_id" TEXT,
  "entity_id" TEXT,
  "payload" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "result" TEXT,
  "error" TEXT,
  "created" TEXT NOT NULL,
  "started" TEXT,
  "finished" TEXT,
  "lease" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "arks"."enrollments" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "fee" BIGINT NOT NULL,
  "created" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "arks"."files" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "size" BIGINT NOT NULL,
  "created" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "arks"."group_members" (
  "group_id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  PRIMARY KEY ("group_id","email")
);

CREATE TABLE IF NOT EXISTS "arks"."import_items" (
  "id" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "generation" INTEGER NOT NULL,
  "drive_file_id" TEXT NOT NULL,
  "revision" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "topic_order" INTEGER NOT NULL DEFAULT 1,
  "source_path" TEXT NOT NULL,
  "source_url" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "size" BIGINT NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "warning" TEXT NOT NULL DEFAULT '',
  "file_id" TEXT,
  "content_id" TEXT,
  "review_note" TEXT NOT NULL DEFAULT '',
  "reviewed_by" TEXT,
  "reviewed_at" TEXT,
  "created" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "arks"."import_runs" (
  "id" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "generation" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "started" TEXT NOT NULL,
  "finished" TEXT,
  "message" TEXT NOT NULL DEFAULT '',
  "discovered" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "arks"."invitations" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'student',
  "fee" BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "arks"."payments" (
  "id" TEXT NOT NULL,
  "enrollment_id" TEXT NOT NULL,
  "amount" BIGINT NOT NULL,
  "reference" TEXT NOT NULL,
  "paid_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "arks"."settings" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "arks"."submissions" (
  "id" TEXT NOT NULL,
  "content_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "file_id" TEXT,
  "feedback" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'submitted',
  "created" TEXT NOT NULL,
  "drive_url" TEXT,
  "drive_status" TEXT NOT NULL DEFAULT 'not_requested',
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "arks"."tests" (
  "id" TEXT NOT NULL,
  "course_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "topic_order" INTEGER NOT NULL,
  "duration" INTEGER NOT NULL,
  "questions" TEXT NOT NULL,
  "published" INTEGER NOT NULL DEFAULT 1,
  "batch_id" TEXT,
  "source_ids" TEXT NOT NULL DEFAULT '[]',
  "ai_generated" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "arks"."tickets" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "reply" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'open',
  "created" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "arks"."users" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'student',
  "phone" TEXT DEFAULT '',
  "goal" TEXT DEFAULT '',
  "onboarded" INTEGER DEFAULT 0,
  "created" TEXT NOT NULL,
  "active" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id")
);

DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_access_groups_batch_id' AND n.nspname='arks') THEN ALTER TABLE "arks"."access_groups" ADD CONSTRAINT "fk_access_groups_batch_id" FOREIGN KEY ("batch_id") REFERENCES "arks"."batches" ("id"); END IF; END $migration$;

DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_admin_credentials_user_id' AND n.nspname='arks') THEN ALTER TABLE "arks"."admin_credentials" ADD CONSTRAINT "fk_admin_credentials_user_id" FOREIGN KEY ("user_id") REFERENCES "arks"."users" ("id"); END IF; END $migration$;

CREATE INDEX IF NOT EXISTS "attempt_user" ON "arks"."attempts" ("user_id","test_id");

DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_attempts_batch_id' AND n.nspname='arks') THEN ALTER TABLE "arks"."attempts" ADD CONSTRAINT "fk_attempts_batch_id" FOREIGN KEY ("batch_id") REFERENCES "arks"."batches" ("id"); END IF; END $migration$;

DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_attempts_user_id' AND n.nspname='arks') THEN ALTER TABLE "arks"."attempts" ADD CONSTRAINT "fk_attempts_user_id" FOREIGN KEY ("user_id") REFERENCES "arks"."users" ("id"); END IF; END $migration$;

DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_attempts_test_id' AND n.nspname='arks') THEN ALTER TABLE "arks"."attempts" ADD CONSTRAINT "fk_attempts_test_id" FOREIGN KEY ("test_id") REFERENCES "arks"."tests" ("id"); END IF; END $migration$;

DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_auth_identities_user_id' AND n.nspname='arks') THEN ALTER TABLE "arks"."auth_identities" ADD CONSTRAINT "fk_auth_identities_user_id" FOREIGN KEY ("user_id") REFERENCES "arks"."users" ("id"); END IF; END $migration$;

DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_auth_sessions_user_id' AND n.nspname='arks') THEN ALTER TABLE "arks"."auth_sessions" ADD CONSTRAINT "fk_auth_sessions_user_id" FOREIGN KEY ("user_id") REFERENCES "arks"."users" ("id"); END IF; END $migration$;

CREATE UNIQUE INDEX IF NOT EXISTS "source_batch" ON "arks"."automation_sources" ("batch_id");

DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_automation_sources_batch_id' AND n.nspname='arks') THEN ALTER TABLE "arks"."automation_sources" ADD CONSTRAINT "fk_automation_sources_batch_id" FOREIGN KEY ("batch_id") REFERENCES "arks"."batches" ("id"); END IF; END $migration$;

DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_batches_course_id' AND n.nspname='arks') THEN ALTER TABLE "arks"."batches" ADD CONSTRAINT "fk_batches_course_id" FOREIGN KEY ("course_id") REFERENCES "arks"."courses" ("id"); END IF; END $migration$;

CREATE UNIQUE INDEX IF NOT EXISTS "completion_unique" ON "arks"."completions" ("user_id","batch_id","content_id");

DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_completions_content_id' AND n.nspname='arks') THEN ALTER TABLE "arks"."completions" ADD CONSTRAINT "fk_completions_content_id" FOREIGN KEY ("content_id") REFERENCES "arks"."content" ("id"); END IF; END $migration$;

DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_completions_batch_id' AND n.nspname='arks') THEN ALTER TABLE "arks"."completions" ADD CONSTRAINT "fk_completions_batch_id" FOREIGN KEY ("batch_id") REFERENCES "arks"."batches" ("id"); END IF; END $migration$;

DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_completions_user_id' AND n.nspname='arks') THEN ALTER TABLE "arks"."completions" ADD CONSTRAINT "fk_completions_user_id" FOREIGN KEY ("user_id") REFERENCES "arks"."users" ("id"); END IF; END $migration$;

CREATE INDEX IF NOT EXISTS "content_course" ON "arks"."content" ("course_id","kind");

DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_content_batch_id' AND n.nspname='arks') THEN ALTER TABLE "arks"."content" ADD CONSTRAINT "fk_content_batch_id" FOREIGN KEY ("batch_id") REFERENCES "arks"."batches" ("id"); END IF; END $migration$;

DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_content_course_id' AND n.nspname='arks') THEN ALTER TABLE "arks"."content" ADD CONSTRAINT "fk_content_course_id" FOREIGN KEY ("course_id") REFERENCES "arks"."courses" ("id"); END IF; END $migration$;

CREATE UNIQUE INDEX IF NOT EXISTS "engine_active_entity" ON "arks"."engine_jobs" ("kind","entity_id") WHERE status IN ('pending','running');

CREATE UNIQUE INDEX IF NOT EXISTS "enrollment_user_batch" ON "arks"."enrollments" ("user_id","batch_id");

DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_enrollments_batch_id' AND n.nspname='arks') THEN ALTER TABLE "arks"."enrollments" ADD CONSTRAINT "fk_enrollments_batch_id" FOREIGN KEY ("batch_id") REFERENCES "arks"."batches" ("id"); END IF; END $migration$;

DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_enrollments_user_id' AND n.nspname='arks') THEN ALTER TABLE "arks"."enrollments" ADD CONSTRAINT "fk_enrollments_user_id" FOREIGN KEY ("user_id") REFERENCES "arks"."users" ("id"); END IF; END $migration$;

DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_group_members_group_id' AND n.nspname='arks') THEN ALTER TABLE "arks"."group_members" ADD CONSTRAINT "fk_group_members_group_id" FOREIGN KEY ("group_id") REFERENCES "arks"."access_groups" ("id"); END IF; END $migration$;

CREATE INDEX IF NOT EXISTS "import_status" ON "arks"."import_items" ("status","source_id");

CREATE UNIQUE INDEX IF NOT EXISTS "import_source_revision" ON "arks"."import_items" ("source_id","generation","drive_file_id","revision");

DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_import_items_source_id' AND n.nspname='arks') THEN ALTER TABLE "arks"."import_items" ADD CONSTRAINT "fk_import_items_source_id" FOREIGN KEY ("source_id") REFERENCES "arks"."automation_sources" ("id"); END IF; END $migration$;

DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_import_runs_source_id' AND n.nspname='arks') THEN ALTER TABLE "arks"."import_runs" ADD CONSTRAINT "fk_import_runs_source_id" FOREIGN KEY ("source_id") REFERENCES "arks"."automation_sources" ("id"); END IF; END $migration$;

CREATE UNIQUE INDEX IF NOT EXISTS "invite_email_batch" ON "arks"."invitations" ("email","batch_id");

DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_invitations_batch_id' AND n.nspname='arks') THEN ALTER TABLE "arks"."invitations" ADD CONSTRAINT "fk_invitations_batch_id" FOREIGN KEY ("batch_id") REFERENCES "arks"."batches" ("id"); END IF; END $migration$;

CREATE UNIQUE INDEX IF NOT EXISTS "payment_reference" ON "arks"."payments" ("reference");

DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_payments_enrollment_id' AND n.nspname='arks') THEN ALTER TABLE "arks"."payments" ADD CONSTRAINT "fk_payments_enrollment_id" FOREIGN KEY ("enrollment_id") REFERENCES "arks"."enrollments" ("id"); END IF; END $migration$;

DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_submissions_batch_id' AND n.nspname='arks') THEN ALTER TABLE "arks"."submissions" ADD CONSTRAINT "fk_submissions_batch_id" FOREIGN KEY ("batch_id") REFERENCES "arks"."batches" ("id"); END IF; END $migration$;

DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_submissions_user_id' AND n.nspname='arks') THEN ALTER TABLE "arks"."submissions" ADD CONSTRAINT "fk_submissions_user_id" FOREIGN KEY ("user_id") REFERENCES "arks"."users" ("id"); END IF; END $migration$;

DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_submissions_content_id' AND n.nspname='arks') THEN ALTER TABLE "arks"."submissions" ADD CONSTRAINT "fk_submissions_content_id" FOREIGN KEY ("content_id") REFERENCES "arks"."content" ("id"); END IF; END $migration$;

DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_tests_course_id' AND n.nspname='arks') THEN ALTER TABLE "arks"."tests" ADD CONSTRAINT "fk_tests_course_id" FOREIGN KEY ("course_id") REFERENCES "arks"."courses" ("id"); END IF; END $migration$;

DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_tickets_batch_id' AND n.nspname='arks') THEN ALTER TABLE "arks"."tickets" ADD CONSTRAINT "fk_tickets_batch_id" FOREIGN KEY ("batch_id") REFERENCES "arks"."batches" ("id"); END IF; END $migration$;

DO $migration$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.conname='fk_tickets_user_id' AND n.nspname='arks') THEN ALTER TABLE "arks"."tickets" ADD CONSTRAINT "fk_tickets_user_id" FOREIGN KEY ("user_id") REFERENCES "arks"."users" ("id"); END IF; END $migration$;

CREATE UNIQUE INDEX IF NOT EXISTS "user_email" ON "arks"."users" ("email");
