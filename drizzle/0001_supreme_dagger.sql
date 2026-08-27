CREATE TABLE `ai_credentials` (
	`id` int AUTO_INCREMENT NOT NULL,
	`discord_user_id` int NOT NULL,
	`provider` enum('openai','anthropic','nvidia','compatible') NOT NULL,
	`encrypted_api_key` text NOT NULL,
	`key_fingerprint` varchar(24) NOT NULL,
	`last_validated_at` timestamp,
	`last_safe_error_code` varchar(80),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ai_credentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_credentials_user_provider_uq` UNIQUE(`discord_user_id`,`provider`)
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`discord_user_id` int,
	`event_type` varchar(100) NOT NULL,
	`entity_type` varchar(80) NOT NULL,
	`entity_id` varchar(80),
	`safe_detail` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `connected_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`discord_user_id` int NOT NULL,
	`provider` enum('gmail','outlook','slack','github') NOT NULL,
	`account_email` varchar(320) NOT NULL,
	`label` varchar(120) NOT NULL,
	`encrypted_refresh_token` text NOT NULL,
	`encrypted_access_token` text,
	`token_expires_at` timestamp,
	`granted_scopes` text NOT NULL,
	`status` enum('connected','reauthorization_required','disconnected','error') NOT NULL DEFAULT 'connected',
	`last_successful_fetch_at` timestamp,
	`last_safe_error_code` varchar(80),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `connected_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `connected_accounts_user_provider_email_uq` UNIQUE(`discord_user_id`,`provider`,`account_email`)
);
--> statement-breakpoint
CREATE TABLE `delivery_schedules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`discord_user_id` int NOT NULL,
	`local_time` varchar(5) NOT NULL,
	`timezone` varchar(64) NOT NULL,
	`schedule_cron_task_uid` varchar(65),
	`status` enum('active','paused','error') NOT NULL DEFAULT 'active',
	`last_scheduled_for` timestamp,
	`last_safe_error_code` varchar(80),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `delivery_schedules_id` PRIMARY KEY(`id`),
	CONSTRAINT `delivery_schedules_user_uq` UNIQUE(`discord_user_id`),
	CONSTRAINT `delivery_schedules_task_uid_uq` UNIQUE(`schedule_cron_task_uid`)
);
--> statement-breakpoint
CREATE TABLE `discord_users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`discord_user_id` varchar(32) NOT NULL,
	`display_name` varchar(200),
	`timezone` varchar(64) NOT NULL DEFAULT 'UTC',
	`daily_delivery_time` varchar(5) NOT NULL DEFAULT '09:00',
	`dm_channel_id` varchar(32),
	`active_ai_provider` enum('openai','anthropic','nvidia','compatible'),
	`active_model` varchar(160),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `discord_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `discord_users_discord_user_id_uq` UNIQUE(`discord_user_id`)
);
--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`id` int AUTO_INCREMENT NOT NULL,
	`state_hash` varchar(64) NOT NULL,
	`discord_user_id` int NOT NULL,
	`provider` enum('gmail','outlook','slack','github') NOT NULL,
	`requested_label` varchar(120) NOT NULL,
	`redirect_uri` varchar(1024) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`consumed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `oauth_states_id` PRIMARY KEY(`id`),
	CONSTRAINT `oauth_states_state_hash_uq` UNIQUE(`state_hash`)
);
--> statement-breakpoint
CREATE TABLE `processed_source_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`connected_account_id` int NOT NULL,
	`external_id` varchar(255) NOT NULL,
	`first_processed_at` timestamp NOT NULL DEFAULT (now()),
	`latest_summary_job_id` int,
	CONSTRAINT `processed_source_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `processed_source_items_account_external_uq` UNIQUE(`connected_account_id`,`external_id`)
);
--> statement-breakpoint
CREATE TABLE `summary_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`summary_job_id` int NOT NULL,
	`discord_user_id` int NOT NULL,
	`headline` varchar(240) NOT NULL,
	`overview` text NOT NULL,
	`item_count` int NOT NULL,
	`no_important_mail` boolean NOT NULL DEFAULT false,
	`discord_message_id` varchar(32),
	`delivered_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `summary_history_id` PRIMARY KEY(`id`),
	CONSTRAINT `summary_history_job_uq` UNIQUE(`summary_job_id`)
);
--> statement-breakpoint
CREATE TABLE `summary_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`schedule_id` int NOT NULL,
	`discord_user_id` int NOT NULL,
	`delivery_date` varchar(10) NOT NULL,
	`idempotency_key` varchar(160) NOT NULL,
	`status` enum('pending','claimed','summarized','delivered','failed') NOT NULL DEFAULT 'pending',
	`claimed_at` timestamp,
	`completed_at` timestamp,
	`delivered_at` timestamp,
	`attempt_count` int NOT NULL DEFAULT 0,
	`last_safe_error_code` varchar(80),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `summary_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `summary_jobs_idempotency_key_uq` UNIQUE(`idempotency_key`)
);
--> statement-breakpoint
ALTER TABLE `ai_credentials` ADD CONSTRAINT `ai_credentials_discord_user_id_discord_users_id_fk` FOREIGN KEY (`discord_user_id`) REFERENCES `discord_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_events` ADD CONSTRAINT `audit_events_discord_user_id_discord_users_id_fk` FOREIGN KEY (`discord_user_id`) REFERENCES `discord_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `connected_accounts` ADD CONSTRAINT `connected_accounts_discord_user_id_discord_users_id_fk` FOREIGN KEY (`discord_user_id`) REFERENCES `discord_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `delivery_schedules` ADD CONSTRAINT `delivery_schedules_discord_user_id_discord_users_id_fk` FOREIGN KEY (`discord_user_id`) REFERENCES `discord_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `oauth_states` ADD CONSTRAINT `oauth_states_discord_user_id_discord_users_id_fk` FOREIGN KEY (`discord_user_id`) REFERENCES `discord_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `processed_source_items` ADD CONSTRAINT `psi_connected_account_fk` FOREIGN KEY (`connected_account_id`) REFERENCES `connected_accounts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `processed_source_items` ADD CONSTRAINT `psi_summary_job_fk` FOREIGN KEY (`latest_summary_job_id`) REFERENCES `summary_jobs`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `summary_history` ADD CONSTRAINT `summary_history_job_fk` FOREIGN KEY (`summary_job_id`) REFERENCES `summary_jobs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `summary_history` ADD CONSTRAINT `summary_history_user_fk` FOREIGN KEY (`discord_user_id`) REFERENCES `discord_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `summary_jobs` ADD CONSTRAINT `summary_jobs_schedule_fk` FOREIGN KEY (`schedule_id`) REFERENCES `delivery_schedules`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `summary_jobs` ADD CONSTRAINT `summary_jobs_user_fk` FOREIGN KEY (`discord_user_id`) REFERENCES `discord_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_events_user_created_idx` ON `audit_events` (`discord_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `connected_accounts_user_status_idx` ON `connected_accounts` (`discord_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `oauth_states_expiry_idx` ON `oauth_states` (`expires_at`);--> statement-breakpoint
CREATE INDEX `summary_jobs_schedule_status_idx` ON `summary_jobs` (`schedule_id`,`status`);
