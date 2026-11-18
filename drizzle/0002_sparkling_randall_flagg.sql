CREATE TABLE `access_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`google_group` text DEFAULT '' NOT NULL,
	`batch_id` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `admin_credentials` (
	`user_id` text PRIMARY KEY NOT NULL,
	`salt` text NOT NULL,
	`password_hash` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `auth_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`reset_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `auth_states` (
	`id` text PRIMARY KEY NOT NULL,
	`verifier` text NOT NULL,
	`expires` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `engine_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`batch_id` text,
	`entity_id` text,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result` text,
	`error` text,
	`created` text NOT NULL,
	`started` text,
	`finished` text,
	`lease` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `engine_active_entity` ON `engine_jobs` (`kind`,`entity_id`) WHERE status IN ('pending','running');--> statement-breakpoint
CREATE TABLE `group_members` (
	`group_id` text NOT NULL,
	`email` text NOT NULL,
	PRIMARY KEY(`group_id`, `email`),
	FOREIGN KEY (`group_id`) REFERENCES `access_groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `attempts` ADD `feedback` text;--> statement-breakpoint
ALTER TABLE `attempts` ADD `grading_status` text DEFAULT 'complete' NOT NULL;--> statement-breakpoint
ALTER TABLE `batches` ADD `config` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `content` ADD `session_status` text DEFAULT 'scheduled' NOT NULL;--> statement-breakpoint
ALTER TABLE `content` ADD `series_id` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `drive_url` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `drive_status` text DEFAULT 'not_requested' NOT NULL;--> statement-breakpoint
ALTER TABLE `tests` ADD `batch_id` text;--> statement-breakpoint
ALTER TABLE `tests` ADD `source_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `tests` ADD `ai_generated` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `active` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
UPDATE tests SET kind='monthly' WHERE kind='topic';
