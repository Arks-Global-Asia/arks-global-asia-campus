CREATE TABLE `automation_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`folder_input` text NOT NULL,
	`folder_id` text,
	`folder_name` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_sync` text,
	`last_error` text,
	`sync_requested` integer DEFAULT 1 NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`created` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_batch` ON `automation_sources` (`batch_id`);--> statement-breakpoint
CREATE TABLE `import_items` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`generation` integer NOT NULL,
	`drive_file_id` text NOT NULL,
	`revision` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`topic` text NOT NULL,
	`topic_order` integer DEFAULT 1 NOT NULL,
	`source_path` text NOT NULL,
	`source_url` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`warning` text DEFAULT '' NOT NULL,
	`file_id` text,
	`content_id` text,
	`review_note` text DEFAULT '' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`created` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `automation_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_source_revision` ON `import_items` (`source_id`,`generation`,`drive_file_id`,`revision`);--> statement-breakpoint
CREATE INDEX `import_status` ON `import_items` (`status`,`source_id`);--> statement-breakpoint
CREATE TABLE `import_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`generation` integer NOT NULL,
	`status` text NOT NULL,
	`started` text NOT NULL,
	`finished` text,
	`message` text DEFAULT '' NOT NULL,
	`discovered` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `automation_sources`(`id`) ON UPDATE no action ON DELETE no action
);
