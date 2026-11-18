CREATE TABLE `attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`test_id` text NOT NULL,
	`user_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`started` text NOT NULL,
	`submitted` text,
	`answers` text,
	`score` integer,
	`total` integer,
	`snapshot` text NOT NULL,
	FOREIGN KEY (`test_id`) REFERENCES `tests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attempt_user` ON `attempts` (`user_id`,`test_id`);--> statement-breakpoint
CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `batches` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`name` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Kolkata' NOT NULL,
	`covered` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `completions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`content_id` text NOT NULL,
	`created` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`content_id`) REFERENCES `content`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `completion_unique` ON `completions` (`user_id`,`batch_id`,`content_id`);--> statement-breakpoint
CREATE TABLE `content` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`batch_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`topic` text NOT NULL,
	`topic_order` integer DEFAULT 1 NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`starts_at` text DEFAULT '' NOT NULL,
	`duration` integer DEFAULT 60 NOT NULL,
	`file_id` text,
	`published` integer DEFAULT 1 NOT NULL,
	`created` text NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `content_course` ON `content` (`course_id`,`kind`);--> statement-breakpoint
CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`syllabus` text NOT NULL,
	`fee` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `enrollments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`fee` integer NOT NULL,
	`created` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `enrollment_user_batch` ON `enrollments` (`user_id`,`batch_id`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`batch_id` text NOT NULL,
	`role` text DEFAULT 'student' NOT NULL,
	`fee` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_email_batch` ON `invitations` (`email`,`batch_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`enrollment_id` text NOT NULL,
	`amount` integer NOT NULL,
	`reference` text NOT NULL,
	`paid_at` text NOT NULL,
	FOREIGN KEY (`enrollment_id`) REFERENCES `enrollments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_reference` ON `payments` (`reference`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`content_id` text NOT NULL,
	`user_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`body` text NOT NULL,
	`file_id` text,
	`feedback` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`created` text NOT NULL,
	FOREIGN KEY (`content_id`) REFERENCES `content`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tests` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`topic_order` integer NOT NULL,
	`duration` integer NOT NULL,
	`questions` text NOT NULL,
	`published` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`reply` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'student' NOT NULL,
	`phone` text DEFAULT '',
	`goal` text DEFAULT '',
	`onboarded` integer DEFAULT 0,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email` ON `users` (`email`);