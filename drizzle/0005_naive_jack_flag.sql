ALTER TABLE `oj_cases` ADD `group_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `oj_problems` ADD `checker` text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE `oj_problems` ADD `scoring` text DEFAULT 'weighted' NOT NULL;--> statement-breakpoint
ALTER TABLE `oj_submissions` ADD `checker` text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE `oj_submissions` ADD `scoring` text DEFAULT 'weighted' NOT NULL;--> statement-breakpoint
ALTER TABLE `oj_submissions` ADD `expected_outputs` text DEFAULT '[]' NOT NULL;