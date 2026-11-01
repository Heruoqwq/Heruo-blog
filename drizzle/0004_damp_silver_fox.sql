CREATE TABLE `oj_files` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `oj_cases` ADD `input_file` text REFERENCES oj_files(id);--> statement-breakpoint
ALTER TABLE `oj_cases` ADD `output_file` text REFERENCES oj_files(id);--> statement-breakpoint
ALTER TABLE `posts` ADD `featured` integer DEFAULT 0 NOT NULL;