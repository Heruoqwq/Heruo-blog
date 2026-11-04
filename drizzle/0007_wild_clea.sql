ALTER TABLE `oj_problems` ADD `difficulty` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `oj_problems` ADD `difficulty_tier` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `oj_problems` ADD `quality` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `oj_problems` ADD `quality_note` text DEFAULT '' NOT NULL;