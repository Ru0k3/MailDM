import {
  boolean,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const sourceProviderValues = ["gmail", "outlook", "slack", "github"] as const;
export const aiProviderValues = ["openai", "anthropic", "nvidia", "compatible"] as const;
export const connectionStatusValues = [
  "connected",
  "reauthorization_required",
  "disconnected",
  "error",
] as const;
export const scheduleStatusValues = ["active", "paused", "error"] as const;
export const summaryJobStatusValues = [
  "pending",
  "claimed",
  "summarized",
  "delivered",
  "failed",
] as const;

/** The Discord identity is the primary MailDM user identity for DM-first onboarding. */
export const discordUsers = mysqlTable(
  "discord_users",
  {
    id: int("id").autoincrement().primaryKey(),
    discordUserId: varchar("discord_user_id", { length: 32 }).notNull(),
    displayName: varchar("display_name", { length: 200 }),
    timezone: varchar("timezone", { length: 64 }).notNull().default("UTC"),
    dailyDeliveryTime: varchar("daily_delivery_time", { length: 5 }).notNull().default("09:00"),
    dmChannelId: varchar("dm_channel_id", { length: 32 }),
    activeAiProvider: mysqlEnum("active_ai_provider", aiProviderValues),
    activeModel: varchar("active_model", { length: 160 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("discord_users_discord_user_id_uq").on(table.discordUserId)]
);

/** One Gmail identity can be connected per label; provider fields enable later source connectors. */
export const connectedAccounts = mysqlTable(
  "connected_accounts",
  {
    id: int("id").autoincrement().primaryKey(),
    discordUserId: int("discord_user_id")
      .notNull()
      .references(() => discordUsers.id, { onDelete: "cascade" }),
    provider: mysqlEnum("provider", sourceProviderValues).notNull(),
    accountEmail: varchar("account_email", { length: 320 }).notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
    encryptedAccessToken: text("encrypted_access_token"),
    tokenExpiresAt: timestamp("token_expires_at"),
    grantedScopes: text("granted_scopes").notNull(),
    status: mysqlEnum("status", connectionStatusValues).notNull().default("connected"),
    lastSuccessfulFetchAt: timestamp("last_successful_fetch_at"),
    lastSafeErrorCode: varchar("last_safe_error_code", { length: 80 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("connected_accounts_user_provider_email_uq").on(
      table.discordUserId,
      table.provider,
      table.accountEmail
    ),
    index("connected_accounts_user_status_idx").on(table.discordUserId, table.status),
  ]
);

/** Raw OAuth state is never retained. Only its SHA-256 digest is stored. */
export const oauthStates = mysqlTable(
  "oauth_states",
  {
    id: int("id").autoincrement().primaryKey(),
    stateHash: varchar("state_hash", { length: 64 }).notNull(),
    discordUserId: int("discord_user_id")
      .notNull()
      .references(() => discordUsers.id, { onDelete: "cascade" }),
    provider: mysqlEnum("provider", sourceProviderValues).notNull(),
    requestedLabel: varchar("requested_label", { length: 120 }).notNull(),
    redirectUri: varchar("redirect_uri", { length: 1024 }).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("oauth_states_state_hash_uq").on(table.stateHash),
    index("oauth_states_expiry_idx").on(table.expiresAt),
  ]
);

export const aiCredentials = mysqlTable(
  "ai_credentials",
  {
    id: int("id").autoincrement().primaryKey(),
    discordUserId: int("discord_user_id")
      .notNull()
      .references(() => discordUsers.id, { onDelete: "cascade" }),
    provider: mysqlEnum("provider", aiProviderValues).notNull(),
    encryptedApiKey: text("encrypted_api_key").notNull(),
    keyFingerprint: varchar("key_fingerprint", { length: 24 }).notNull(),
    lastValidatedAt: timestamp("last_validated_at"),
    lastSafeErrorCode: varchar("last_safe_error_code", { length: 80 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("ai_credentials_user_provider_uq").on(table.discordUserId, table.provider)]
);

export const deliverySchedules = mysqlTable(
  "delivery_schedules",
  {
    id: int("id").autoincrement().primaryKey(),
    discordUserId: int("discord_user_id")
      .notNull()
      .references(() => discordUsers.id, { onDelete: "cascade" }),
    localTime: varchar("local_time", { length: 5 }).notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    scheduleCronTaskUid: varchar("schedule_cron_task_uid", { length: 65 }),
    status: mysqlEnum("status", scheduleStatusValues).notNull().default("active"),
    lastScheduledFor: timestamp("last_scheduled_for"),
    lastSafeErrorCode: varchar("last_safe_error_code", { length: 80 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("delivery_schedules_user_uq").on(table.discordUserId),
    uniqueIndex("delivery_schedules_task_uid_uq").on(table.scheduleCronTaskUid),
  ]
);

export const summaryJobs = mysqlTable(
  "summary_jobs",
  {
    id: int("id").autoincrement().primaryKey(),
    scheduleId: int("schedule_id")
      .notNull()
      .references(() => deliverySchedules.id, { onDelete: "cascade" }),
    discordUserId: int("discord_user_id")
      .notNull()
      .references(() => discordUsers.id, { onDelete: "cascade" }),
    deliveryDate: varchar("delivery_date", { length: 10 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    status: mysqlEnum("status", summaryJobStatusValues).notNull().default("pending"),
    claimedAt: timestamp("claimed_at"),
    completedAt: timestamp("completed_at"),
    deliveredAt: timestamp("delivered_at"),
    attemptCount: int("attempt_count").notNull().default(0),
    lastSafeErrorCode: varchar("last_safe_error_code", { length: 80 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("summary_jobs_idempotency_key_uq").on(table.idempotencyKey),
    index("summary_jobs_schedule_status_idx").on(table.scheduleId, table.status),
  ]
);

export const summaryHistory = mysqlTable(
  "summary_history",
  {
    id: int("id").autoincrement().primaryKey(),
    summaryJobId: int("summary_job_id")
      .notNull()
      .references(() => summaryJobs.id, { onDelete: "cascade" }),
    discordUserId: int("discord_user_id")
      .notNull()
      .references(() => discordUsers.id, { onDelete: "cascade" }),
    headline: varchar("headline", { length: 240 }).notNull(),
    overview: text("overview").notNull(),
    itemCount: int("item_count").notNull(),
    noImportantMail: boolean("no_important_mail").notNull().default(false),
    feedback: varchar("feedback", { length: 8 }),
    discordMessageId: varchar("discord_message_id", { length: 32 }),
    deliveredAt: timestamp("delivered_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  table => [uniqueIndex("summary_history_job_uq").on(table.summaryJobId)]
);

/** Used for deduplication only; raw subject and body are never persisted. */
export const processedSourceItems = mysqlTable(
  "processed_source_items",
  {
    id: int("id").autoincrement().primaryKey(),
    connectedAccountId: int("connected_account_id")
      .notNull()
      .references(() => connectedAccounts.id, { onDelete: "cascade" }),
    externalId: varchar("external_id", { length: 255 }).notNull(),
    firstProcessedAt: timestamp("first_processed_at").defaultNow().notNull(),
    latestSummaryJobId: int("latest_summary_job_id").references(() => summaryJobs.id, {
      onDelete: "set null",
    }),
  },
  table => [
    uniqueIndex("processed_source_items_account_external_uq").on(
      table.connectedAccountId,
      table.externalId
    ),
  ]
);

/** Only safe identifiers and reason codes are suitable for audit persistence. */
export const auditEvents = mysqlTable(
  "audit_events",
  {
    id: int("id").autoincrement().primaryKey(),
    discordUserId: int("discord_user_id").references(() => discordUsers.id, {
      onDelete: "set null",
    }),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    entityType: varchar("entity_type", { length: 80 }).notNull(),
    entityId: varchar("entity_id", { length: 80 }),
    safeDetail: varchar("safe_detail", { length: 500 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  table => [index("audit_events_user_created_idx").on(table.discordUserId, table.createdAt)]
);

export type DiscordUser = typeof discordUsers.$inferSelect;
export type ConnectedAccount = typeof connectedAccounts.$inferSelect;
export type DeliverySchedule = typeof deliverySchedules.$inferSelect;
