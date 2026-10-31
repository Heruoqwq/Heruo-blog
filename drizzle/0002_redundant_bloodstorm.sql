CREATE TABLE `oj_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`problem_id` integer NOT NULL,
	`position` integer NOT NULL,
	`input` text NOT NULL,
	`output` text NOT NULL,
	`weight` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`problem_id`) REFERENCES `oj_problems`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `oj_cases_problem` ON `oj_cases` (`problem_id`,`position`);--> statement-breakpoint
CREATE TABLE `oj_problems` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`statement` text NOT NULL,
	`samples` text DEFAULT '[]' NOT NULL,
	`time_limit` integer DEFAULT 1000 NOT NULL,
	`memory_limit` integer DEFAULT 256 NOT NULL,
	`published` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oj_problems_code_unique` ON `oj_problems` (`code`);--> statement-breakpoint
CREATE TABLE `oj_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`problem_id` integer NOT NULL,
	`problem_code` text NOT NULL,
	`problem_title` text NOT NULL,
	`source` text NOT NULL,
	`revision` integer NOT NULL,
	`status` text DEFAULT 'QUEUED' NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`passed` integer DEFAULT 0 NOT NULL,
	`total` integer NOT NULL,
	`time` integer DEFAULT 0 NOT NULL,
	`memory` integer DEFAULT 0 NOT NULL,
	`details` text DEFAULT '[]' NOT NULL,
	`compile_log` text DEFAULT '' NOT NULL,
	`judge_tokens` text DEFAULT '[]' NOT NULL,
	`judge_url` text NOT NULL,
	`time_limit` integer NOT NULL,
	`memory_limit` integer NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`problem_id`) REFERENCES `oj_problems`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `oj_submissions_user` ON `oj_submissions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `oj_submissions_problem` ON `oj_submissions` (`problem_id`,`created_at`);