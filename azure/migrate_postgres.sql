cat << 'EOF' > ~/arks-global-asia-campus/azure/migrate_postgres.sql
BEGIN;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'student' NOT NULL,
  phone TEXT DEFAULT '',
  goal TEXT DEFAULT '',
  active INTEGER DEFAULT 1 NOT NULL,
  onboarded INTEGER DEFAULT 0,
  created TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS user_email ON users (email);

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  syllabus TEXT NOT NULL,
  fee INTEGER DEFAULT 0 NOT NULL,
  currency TEXT DEFAULT 'INR' NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size BIGINT NOT NULL,
  created TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
  id TEXT PRIMARY KEY NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  created TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_limits (
  id TEXT PRIMARY KEY NOT NULL,
  attempts INTEGER DEFAULT 0 NOT NULL,
  reset_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_states (
  id TEXT PRIMARY KEY NOT NULL,
  verifier TEXT NOT NULL,
  expires TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS engine_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  batch_id TEXT,
  entity_id TEXT,
  payload TEXT NOT NULL,
  status TEXT DEFAULT 'pending' NOT NULL,
  result TEXT,
  error TEXT,
  created TEXT NOT NULL,
  started TEXT,
  finished TEXT,
  lease TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS engine_active_entity ON engine_jobs (kind, entity_id) WHERE status IN ('pending', 'running');

CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY NOT NULL,
  course_id TEXT NOT NULL REFERENCES courses(id),
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  config TEXT DEFAULT '{}' NOT NULL,
  timezone TEXT DEFAULT 'Asia/Kolkata' NOT NULL,
  covered INTEGER DEFAULT 0 NOT NULL,
  status TEXT DEFAULT 'active' NOT NULL
);

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  batch_id TEXT NOT NULL REFERENCES batches(id),
  role TEXT DEFAULT 'student' NOT NULL,
  fee INTEGER DEFAULT 0 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS invite_email_batch ON invitations (email, batch_id);

CREATE TABLE IF NOT EXISTS enrollments (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  batch_id TEXT NOT NULL REFERENCES batches(id),
  fee INTEGER NOT NULL,
  created TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS enrollment_user_batch ON enrollments (user_id, batch_id);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY NOT NULL,
  enrollment_id TEXT NOT NULL REFERENCES enrollments(id),
  amount INTEGER NOT NULL,
  reference TEXT NOT NULL,
  paid_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_reference ON payments (reference);

CREATE TABLE IF NOT EXISTS content (
  id TEXT PRIMARY KEY NOT NULL,
  course_id TEXT NOT NULL REFERENCES courses(id),
  batch_id TEXT REFERENCES batches(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  topic TEXT NOT NULL,
  topic_order INTEGER DEFAULT 1 NOT NULL,
  body TEXT DEFAULT '' NOT NULL,
  url TEXT DEFAULT '' NOT NULL,
  session_status TEXT DEFAULT 'scheduled' NOT NULL,
  series_id TEXT,
  starts_at TEXT DEFAULT '' NOT NULL,
  duration INTEGER DEFAULT 60 NOT NULL,
  file_id TEXT,
  published INTEGER DEFAULT 1 NOT NULL,
  created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS content_course ON content (course_id, kind);

CREATE TABLE IF NOT EXISTS completions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  batch_id TEXT NOT NULL REFERENCES batches(id),
  content_id TEXT NOT NULL REFERENCES content(id),
  created TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS completion_unique ON completions (user_id, batch_id, content_id);

CREATE TABLE IF NOT EXISTS tests (
  id TEXT PRIMARY KEY NOT NULL,
  course_id TEXT NOT NULL REFERENCES courses(id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  topic_order INTEGER NOT NULL,
  duration INTEGER NOT NULL,
  batch_id TEXT,
  source_ids TEXT DEFAULT '[]' NOT NULL,
  ai_generated INTEGER DEFAULT 0 NOT NULL,
  questions TEXT NOT NULL,
  published INTEGER DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY NOT NULL,
  test_id TEXT NOT NULL REFERENCES tests(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  batch_id TEXT NOT NULL REFERENCES batches(id),
  started TEXT NOT NULL,
  submitted TEXT,
  answers TEXT,
  score NUMERIC,
  total INTEGER,
  feedback TEXT,
  summary TEXT DEFAULT '{}' NOT NULL,
  grading_status TEXT DEFAULT 'complete' NOT NULL,
  snapshot TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attempt_user ON attempts (user_id, test_id);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY NOT NULL,
  content_id TEXT NOT NULL REFERENCES content(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  batch_id TEXT NOT NULL REFERENCES batches(id),
  body TEXT NOT NULL,
  file_id TEXT,
  drive_url TEXT,
  drive_status TEXT DEFAULT 'not_requested' NOT NULL,
  feedback TEXT DEFAULT '' NOT NULL,
  status TEXT DEFAULT 'submitted' NOT NULL,
  created TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  batch_id TEXT NOT NULL REFERENCES batches(id),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  reply TEXT DEFAULT '' NOT NULL,
  category TEXT DEFAULT 'academic' NOT NULL,
  messages TEXT DEFAULT '[]' NOT NULL,
  status TEXT DEFAULT 'open' NOT NULL,
  created TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_sources (
  id TEXT PRIMARY KEY NOT NULL,
  batch_id TEXT NOT NULL REFERENCES batches(id),
  folder_input TEXT NOT NULL,
  folder_id TEXT,
  folder_name TEXT,
  enabled INTEGER DEFAULT 1 NOT NULL,
  status TEXT DEFAULT 'pending' NOT NULL,
  last_sync TEXT,
  last_error TEXT,
  sync_requested INTEGER DEFAULT 1 NOT NULL,
  generation INTEGER DEFAULT 1 NOT NULL,
  config TEXT DEFAULT '{}' NOT NULL,
  created TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS source_batch ON automation_sources (batch_id);

CREATE TABLE IF NOT EXISTS import_runs (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL REFERENCES automation_sources(id),
  generation INTEGER NOT NULL,
  status TEXT NOT NULL,
  started TEXT NOT NULL,
  finished TEXT,
  message TEXT DEFAULT '' NOT NULL,
  discovered INTEGER DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS import_items (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL REFERENCES automation_sources(id),
  generation INTEGER NOT NULL,
  drive_file_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  topic TEXT NOT NULL,
  topic_order INTEGER DEFAULT 1 NOT NULL,
  source_path TEXT NOT NULL,
  source_url TEXT NOT NULL,
  mime TEXT NOT NULL,
  size BIGINT DEFAULT 0 NOT NULL,
  status TEXT DEFAULT 'pending' NOT NULL,
  warning TEXT DEFAULT '' NOT NULL,
  file_id TEXT,
  content_id TEXT,
  review_note TEXT DEFAULT '' NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  class_date TEXT DEFAULT '' NOT NULL,
  created TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS import_source_revision ON import_items (source_id, generation, drive_file_id, revision);
CREATE INDEX IF NOT EXISTS import_status ON import_items (status, source_id);

CREATE TABLE IF NOT EXISTS access_groups (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  google_group TEXT DEFAULT '' NOT NULL,
  batch_id TEXT NOT NULL REFERENCES batches(id)
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL REFERENCES access_groups(id),
  email TEXT NOT NULL,
  PRIMARY KEY (group_id, email)
);

CREATE TABLE IF NOT EXISTS admin_credentials (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id),
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires TEXT NOT NULL
);

ALTER TABLE attempts ADD COLUMN IF NOT EXISTS feedback TEXT;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS grading_status TEXT NOT NULL DEFAULT 'complete';
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS summary TEXT NOT NULL DEFAULT '{}';
ALTER TABLE batches ADD COLUMN IF NOT EXISTS config TEXT NOT NULL DEFAULT '{}';
ALTER TABLE content ADD COLUMN IF NOT EXISTS session_status TEXT NOT NULL DEFAULT 'scheduled';
ALTER TABLE content ADD COLUMN IF NOT EXISTS series_id TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS drive_url TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS drive_status TEXT NOT NULL DEFAULT 'not_requested';
ALTER TABLE tests ADD COLUMN IF NOT EXISTS batch_id TEXT;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS source_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tests ADD COLUMN IF NOT EXISTS ai_generated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'academic';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS messages TEXT NOT NULL DEFAULT '[]';
ALTER TABLE automation_sources ADD COLUMN IF NOT EXISTS config TEXT NOT NULL DEFAULT '{}';
ALTER TABLE import_items ADD COLUMN IF NOT EXISTS class_date TEXT NOT NULL DEFAULT '';

COMMIT;
EOF