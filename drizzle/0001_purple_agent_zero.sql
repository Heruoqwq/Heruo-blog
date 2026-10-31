CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`disabled` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "users_role" CHECK((id=1 AND role='superadmin') OR (id>1 AND role='user'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
ALTER TABLE `posts` ADD `author_id` integer REFERENCES users(id);--> statement-breakpoint
CREATE INDEX `posts_author_date` ON `posts` (`author_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `user_id` integer REFERENCES users(id);--> statement-breakpoint
CREATE INDEX `sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `user_id` integer REFERENCES users(id);--> statement-breakpoint
CREATE INDEX `tasks_user_date` ON `tasks` (`user_id`,`created_at`);