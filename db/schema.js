import { sql } from "drizzle-orm";
import {
  sqliteTable,
  primaryKey,
  text,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull().default("student"),
    phone: text("phone").default(""),
    goal: text("goal").default(""),
    active: integer("active").notNull().default(1),
    onboarded: integer("onboarded").default(0),
    created: text("created").notNull(),
  },
  (t) => [uniqueIndex("user_email").on(t.email)],
);
export const courses = sqliteTable("courses", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  syllabus: text("syllabus").notNull(),
  fee: integer("fee").notNull().default(0),
  currency: text("currency").notNull().default("INR"),
});
export const batches = sqliteTable("batches", {
  id: text("id").primaryKey(),
  course_id: text("course_id")
    .notNull()
    .references(() => courses.id),
  name: text("name").notNull(),
  start_date: text("start_date").notNull(),
  end_date: text("end_date").notNull(),
  config: text("config").notNull().default("{}"),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  covered: integer("covered").notNull().default(0),
  status: text("status").notNull().default("active"),
});
export const invitations = sqliteTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    batch_id: text("batch_id")
      .notNull()
      .references(() => batches.id),
    role: text("role").notNull().default("student"),
    fee: integer("fee").notNull().default(0),
  },
  (t) => [uniqueIndex("invite_email_batch").on(t.email, t.batch_id)],
);
export const enrollments = sqliteTable(
  "enrollments",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id),
    batch_id: text("batch_id")
      .notNull()
      .references(() => batches.id),
    fee: integer("fee").notNull(),
    created: text("created").notNull(),
  },
  (t) => [uniqueIndex("enrollment_user_batch").on(t.user_id, t.batch_id)],
);
export const content = sqliteTable(
  "content",
  {
    id: text("id").primaryKey(),
    course_id: text("course_id")
      .notNull()
      .references(() => courses.id),
    batch_id: text("batch_id").references(() => batches.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    topic: text("topic").notNull(),
    topic_order: integer("topic_order").notNull().default(1),
    body: text("body").notNull().default(""),
    url: text("url").notNull().default(""),
    session_status: text("session_status").notNull().default("scheduled"),
    series_id: text("series_id"),
    starts_at: text("starts_at").notNull().default(""),
    duration: integer("duration").notNull().default(60),
    file_id: text("file_id"),
    published: integer("published").notNull().default(1),
    created: text("created").notNull(),
  },
  (t) => [index("content_course").on(t.course_id, t.kind)],
);
export const completions = sqliteTable(
  "completions",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id),
    batch_id: text("batch_id")
      .notNull()
      .references(() => batches.id),
    content_id: text("content_id")
      .notNull()
      .references(() => content.id),
    created: text("created").notNull(),
  },
  (t) => [
    uniqueIndex("completion_unique").on(t.user_id, t.batch_id, t.content_id),
  ],
);
export const tests = sqliteTable("tests", {
  id: text("id").primaryKey(),
  course_id: text("course_id")
    .notNull()
    .references(() => courses.id),
  title: text("title").notNull(),
  kind: text("kind").notNull(),
  topic_order: integer("topic_order").notNull(),
  duration: integer("duration").notNull(),
  batch_id: text("batch_id"),
  source_ids: text("source_ids").notNull().default("[]"),
  ai_generated: integer("ai_generated").notNull().default(0),
  questions: text("questions").notNull(),
  published: integer("published").notNull().default(1),
});
export const attempts = sqliteTable(
  "attempts",
  {
    id: text("id").primaryKey(),
    test_id: text("test_id")
      .notNull()
      .references(() => tests.id),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id),
    batch_id: text("batch_id")
      .notNull()
      .references(() => batches.id),
    started: text("started").notNull(),
    submitted: text("submitted"),
    answers: text("answers"),
    score: integer("score"),
    total: integer("total"),
    feedback: text("feedback"),
    summary: text("summary").notNull().default("{}"),
    grading_status: text("grading_status").notNull().default("complete"),
    snapshot: text("snapshot").notNull(),
  },
  (t) => [index("attempt_user").on(t.user_id, t.test_id)],
);
export const submissions = sqliteTable("submissions", {
  id: text("id").primaryKey(),
  content_id: text("content_id")
    .notNull()
    .references(() => content.id),
  user_id: text("user_id")
    .notNull()
    .references(() => users.id),
  batch_id: text("batch_id")
    .notNull()
    .references(() => batches.id),
  body: text("body").notNull(),
  file_id: text("file_id"),
  drive_url: text("drive_url"),
  drive_status: text("drive_status").notNull().default("not_requested"),
  feedback: text("feedback").notNull().default(""),
  status: text("status").notNull().default("submitted"),
  created: text("created").notNull(),
});
export const tickets = sqliteTable("tickets", {
  id: text("id").primaryKey(),
  user_id: text("user_id")
    .notNull()
    .references(() => users.id),
  batch_id: text("batch_id")
    .notNull()
    .references(() => batches.id),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  category: text("category").notNull().default("academic"),
  messages: text("messages").notNull().default("[]"),
  reply: text("reply").notNull().default(""),
  status: text("status").notNull().default("open"),
  created: text("created").notNull(),
});
export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    enrollment_id: text("enrollment_id")
      .notNull()
      .references(() => enrollments.id),
    amount: integer("amount").notNull(),
    reference: text("reference").notNull(),
    paid_at: text("paid_at").notNull(),
  },
  (t) => [uniqueIndex("payment_reference").on(t.reference)],
);
export const files = sqliteTable("files", {
  id: text("id").primaryKey(),
  owner_id: text("owner_id").notNull(),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  created: text("created").notNull(),
});
export const audit = sqliteTable("audit", {
  id: text("id").primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  created: text("created").notNull(),
});

export const automationSources = sqliteTable(
  "automation_sources",
  {
    id: text("id").primaryKey(),
    batch_id: text("batch_id")
      .notNull()
      .references(() => batches.id),
    folder_input: text("folder_input").notNull(),
    folder_id: text("folder_id"),
    folder_name: text("folder_name"),
    enabled: integer("enabled").notNull().default(1),
    status: text("status").notNull().default("pending"),
    last_sync: text("last_sync"),
    last_error: text("last_error"),
    sync_requested: integer("sync_requested").notNull().default(1),
    generation: integer("generation").notNull().default(1),
    config: text("config").notNull().default("{}"),
    created: text("created").notNull(),
  },
  (t) => [uniqueIndex("source_batch").on(t.batch_id)],
);
export const importRuns = sqliteTable("import_runs", {
  id: text("id").primaryKey(),
  source_id: text("source_id")
    .notNull()
    .references(() => automationSources.id),
  generation: integer("generation").notNull(),
  status: text("status").notNull(),
  started: text("started").notNull(),
  finished: text("finished"),
  message: text("message").notNull().default(""),
  discovered: integer("discovered").notNull().default(0),
});
export const importItems = sqliteTable(
  "import_items",
  {
    id: text("id").primaryKey(),
    source_id: text("source_id")
      .notNull()
      .references(() => automationSources.id),
    generation: integer("generation").notNull(),
    drive_file_id: text("drive_file_id").notNull(),
    revision: text("revision").notNull(),
    title: text("title").notNull(),
    kind: text("kind").notNull(),
    topic: text("topic").notNull(),
    topic_order: integer("topic_order").notNull().default(1),
    source_path: text("source_path").notNull(),
    source_url: text("source_url").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull().default(0),
    status: text("status").notNull().default("pending"),
    warning: text("warning").notNull().default(""),
    file_id: text("file_id"),
    content_id: text("content_id"),
    review_note: text("review_note").notNull().default(""),
    reviewed_by: text("reviewed_by"),
    reviewed_at: text("reviewed_at"),
    class_date: text("class_date").notNull().default(""),
    created: text("created").notNull(),
  },
  (t) => [
    uniqueIndex("import_source_revision").on(
      t.source_id,
      t.generation,
      t.drive_file_id,
      t.revision,
    ),
    index("import_status").on(t.status, t.source_id),
  ],
);

export const authSessions = sqliteTable("auth_sessions", {
  id: text("id").primaryKey(),
  user_id: text("user_id")
    .notNull()
    .references(() => users.id),
  expires: text("expires").notNull(),
});
export const authStates = sqliteTable("auth_states", {
  id: text("id").primaryKey(),
  verifier: text("verifier").notNull(),
  expires: text("expires").notNull(),
});
export const adminCredentials = sqliteTable("admin_credentials", {
  user_id: text("user_id")
    .primaryKey()
    .references(() => users.id),
  salt: text("salt").notNull(),
  password_hash: text("password_hash").notNull(),
});
export const authLimits = sqliteTable("auth_limits", {
  id: text("id").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  reset_at: integer("reset_at").notNull(),
});
export const accessGroups = sqliteTable("access_groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  google_group: text("google_group").notNull().default(""),
  batch_id: text("batch_id")
    .notNull()
    .references(() => batches.id),
});
export const groupMembers = sqliteTable(
  "group_members",
  {
    group_id: text("group_id")
      .notNull()
      .references(() => accessGroups.id),
    email: text("email").notNull(),
  },
  (t) => [primaryKey({ columns: [t.group_id, t.email] })],
);
export const engineJobs = sqliteTable(
  "engine_jobs",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    batch_id: text("batch_id"),
    entity_id: text("entity_id"),
    payload: text("payload").notNull(),
    status: text("status").notNull().default("pending"),
    result: text("result"),
    error: text("error"),
    created: text("created").notNull(),
    started: text("started"),
    finished: text("finished"),
    lease: text("lease"),
  },
  (t) => [
    uniqueIndex("engine_active_entity")
      .on(t.kind, t.entity_id)
      .where(sql`status IN ('pending','running')`),
  ],
);
