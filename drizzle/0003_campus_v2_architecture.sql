ALTER TABLE `attempts` ADD `summary` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `tickets` ADD `category` text DEFAULT 'academic' NOT NULL;--> statement-breakpoint
ALTER TABLE `tickets` ADD `messages` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `automation_sources` ADD `config` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `import_items` ADD `class_date` text DEFAULT '' NOT NULL;
