ALTER TABLE `oj_submissions` ADD `judge_error` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `oj_submissions` ADD `judge_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `oj_submissions` ADD `judge_started_at` integer DEFAULT 0 NOT NULL;