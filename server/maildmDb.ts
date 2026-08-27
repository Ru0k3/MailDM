import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  aiCredentials,
  auditEvents,
  connectedAccounts,
  deliverySchedules,
  discordUsers,
  oauthStates,
  processedSourceItems,
  summaryHistory,
  summaryJobs,
} from "../drizzle/schema";
import { getDb } from "./db";
import type { AiProvider, SourceProvider } from "./maildmTypes";

async function requiredDb() {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db;
}

export async function upsertDiscordUser(discordUserId: string, displayName: string | null) {
  const db = await requiredDb();
  await db
    .insert(discordUsers)
    .values({ discordUserId, displayName })
    .onDuplicateKeyUpdate({ set: { displayName, updatedAt: new Date() } });
  return getDiscordUser(discordUserId);
}

export async function getDiscordUser(discordUserId: string) {
  const db = await requiredDb();
  const rows = await db.select().from(discordUsers).where(eq(discordUsers.discordUserId, discordUserId)).limit(1);
  return rows[0] ?? null;
}

export async function getDiscordUserById(id: number) {
  const db = await requiredDb();
  const rows = await db.select().from(discordUsers).where(eq(discordUsers.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listConnectedAccounts(discordUserId: number) {
  const db = await requiredDb();
  return db
    .select({ id: connectedAccounts.id, accountEmail: connectedAccounts.accountEmail, label: connectedAccounts.label, status: connectedAccounts.status, provider: connectedAccounts.provider, lastSuccessfulFetchAt: connectedAccounts.lastSuccessfulFetchAt })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.discordUserId, discordUserId))
    .orderBy(desc(connectedAccounts.createdAt));
}

export async function createOAuthState(input: {
  stateHash: string;
  discordUserId: number;
  provider: SourceProvider;
  requestedLabel: string;
  redirectUri: string;
  expiresAt: Date;
}) {
  const db = await requiredDb();
  await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
  await db.insert(oauthStates).values(input);
}

export async function consumeOAuthState(stateHash: string) {
  const db = await requiredDb();
  const rows = await db.select().from(oauthStates).where(eq(oauthStates.stateHash, stateHash)).limit(1);
  const state = rows[0];
  if (!state || state.consumedAt || state.expiresAt <= new Date()) return null;
  const update = await db
    .update(oauthStates)
    .set({ consumedAt: new Date() })
    .where(and(eq(oauthStates.id, state.id), isNull(oauthStates.consumedAt), gt(oauthStates.expiresAt, new Date())));
  if (update[0].affectedRows !== 1) return null;
  return state;
}

export async function upsertGmailAccount(input: {
  discordUserId: number;
  accountEmail: string;
  label: string;
  encryptedRefreshToken: string;
  encryptedAccessToken: string;
  tokenExpiresAt: Date | null;
  grantedScopes: string;
}) {
  const db = await requiredDb();
  await db
    .insert(connectedAccounts)
    .values({ ...input, provider: "gmail", status: "connected" })
    .onDuplicateKeyUpdate({
      set: {
        label: input.label,
        encryptedRefreshToken: input.encryptedRefreshToken,
        encryptedAccessToken: input.encryptedAccessToken,
        tokenExpiresAt: input.tokenExpiresAt,
        grantedScopes: input.grantedScopes,
        status: "connected",
        lastSafeErrorCode: null,
        updatedAt: new Date(),
      },
    });
  const rows = await db
    .select()
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.discordUserId, input.discordUserId), eq(connectedAccounts.provider, "gmail"), eq(connectedAccounts.accountEmail, input.accountEmail)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getGmailAccount(accountId: number) {
  const db = await requiredDb();
  const rows = await db.select().from(connectedAccounts).where(and(eq(connectedAccounts.id, accountId), eq(connectedAccounts.provider, "gmail"))).limit(1);
  return rows[0] ?? null;
}

export async function listActiveGmailAccounts(discordUserId: number) {
  const db = await requiredDb();
  return db.select().from(connectedAccounts).where(and(eq(connectedAccounts.discordUserId, discordUserId), eq(connectedAccounts.provider, "gmail"), eq(connectedAccounts.status, "connected")));
}

export async function disconnectAccount(discordUserId: number, accountId: number) {
  const db = await requiredDb();
  await db
    .update(connectedAccounts)
    .set({ status: "disconnected", encryptedAccessToken: null, encryptedRefreshToken: "revoked", updatedAt: new Date() })
    .where(and(eq(connectedAccounts.id, accountId), eq(connectedAccounts.discordUserId, discordUserId)));
}

export async function markAccountNeedsReauthorization(accountId: number, safeErrorCode: string) {
  const db = await requiredDb();
  await db
    .update(connectedAccounts)
    .set({ status: "reauthorization_required", lastSafeErrorCode: safeErrorCode.slice(0, 80), updatedAt: new Date() })
    .where(and(eq(connectedAccounts.id, accountId), eq(connectedAccounts.provider, "gmail")));
}

export async function upsertAiCredential(input: {
  discordUserId: number;
  provider: AiProvider;
  encryptedApiKey: string;
  keyFingerprint: string;
}) {
  const db = await requiredDb();
  await db
    .insert(aiCredentials)
    .values({ ...input, lastValidatedAt: new Date(), lastSafeErrorCode: null })
    .onDuplicateKeyUpdate({
      set: {
        encryptedApiKey: input.encryptedApiKey,
        keyFingerprint: input.keyFingerprint,
        lastValidatedAt: new Date(),
        lastSafeErrorCode: null,
        updatedAt: new Date(),
      },
    });
}

export async function setAiSelection(discordUserId: number, provider: AiProvider, model: string) {
  const db = await requiredDb();
  await db.update(discordUsers).set({ activeAiProvider: provider, activeModel: model, updatedAt: new Date() }).where(eq(discordUsers.id, discordUserId));
}

export async function getActiveAiCredential(discordUserId: number) {
  const db = await requiredDb();
  const user = (await db.select().from(discordUsers).where(eq(discordUsers.id, discordUserId)).limit(1))[0];
  if (!user?.activeAiProvider || !user.activeModel) return null;
  const credential = (await db.select().from(aiCredentials).where(and(eq(aiCredentials.discordUserId, discordUserId), eq(aiCredentials.provider, user.activeAiProvider))).limit(1))[0];
  return credential ? { provider: user.activeAiProvider, model: user.activeModel, encryptedApiKey: credential.encryptedApiKey } : null;
}

export async function upsertSchedulePreference(discordUserId: number, localTime: string, timezone: string) {
  const db = await requiredDb();
  await db
    .insert(deliverySchedules)
    .values({ discordUserId, localTime, timezone, status: "active" })
    .onDuplicateKeyUpdate({ set: { localTime, timezone, status: "active", lastSafeErrorCode: null, updatedAt: new Date() } });
  const rows = await db.select().from(deliverySchedules).where(eq(deliverySchedules.discordUserId, discordUserId)).limit(1);
  return rows[0] ?? null;
}

export async function attachScheduleTask(scheduleId: number, taskUid: string) {
  const db = await requiredDb();
  await db.update(deliverySchedules).set({ scheduleCronTaskUid: taskUid, status: "active", updatedAt: new Date() }).where(eq(deliverySchedules.id, scheduleId));
}

export async function getScheduleByTaskUid(taskUid: string) {
  const db = await requiredDb();
  const rows = await db.select().from(deliverySchedules).where(eq(deliverySchedules.scheduleCronTaskUid, taskUid)).limit(1);
  return rows[0] ?? null;
}

export async function getScheduleByDiscordUserId(discordUserId: number) {
  const db = await requiredDb();
  const rows = await db.select().from(deliverySchedules).where(eq(deliverySchedules.discordUserId, discordUserId)).limit(1);
  return rows[0] ?? null;
}

export async function createOrGetSummaryJob(scheduleId: number, discordUserId: number, deliveryDate: string, idempotencyKey: string) {
  const db = await requiredDb();
  await db.insert(summaryJobs).values({ scheduleId, discordUserId, deliveryDate, idempotencyKey }).onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
  const rows = await db.select().from(summaryJobs).where(eq(summaryJobs.idempotencyKey, idempotencyKey)).limit(1);
  return rows[0] ?? null;
}

export async function claimSummaryJob(jobId: number) {
  const db = await requiredDb();
  const staleClaim = new Date(Date.now() - 10 * 60 * 1000);
  const result = await db
    .update(summaryJobs)
    .set({ status: "claimed", claimedAt: new Date(), attemptCount: sql`${summaryJobs.attemptCount} + 1`, updatedAt: new Date() })
    .where(and(eq(summaryJobs.id, jobId), or(eq(summaryJobs.status, "pending"), eq(summaryJobs.status, "failed"), and(eq(summaryJobs.status, "claimed"), lt(summaryJobs.claimedAt, staleClaim)))));
  return result[0].affectedRows === 1;
}

export async function getProcessedExternalIds(accountIds: number[]) {
  if (accountIds.length === 0) return new Map<number, Set<string>>();
  const db = await requiredDb();
  const rows = await db.select().from(processedSourceItems).where(inArray(processedSourceItems.connectedAccountId, accountIds));
  return rows.reduce((map, row) => {
    const current = map.get(row.connectedAccountId) ?? new Set<string>();
    current.add(row.externalId);
    map.set(row.connectedAccountId, current);
    return map;
  }, new Map<number, Set<string>>());
}

export async function recordProcessedItems(accountId: number, externalIds: string[], jobId: number) {
  if (externalIds.length === 0) return;
  const db = await requiredDb();
  await db.insert(processedSourceItems).values(externalIds.map(externalId => ({ connectedAccountId: accountId, externalId, latestSummaryJobId: jobId }))).onDuplicateKeyUpdate({ set: { latestSummaryJobId: jobId } });
}

export async function saveSummaryHistory(input: { jobId: number; discordUserId: number; headline: string; overview: string; itemCount: number; noImportantMail: boolean; discordMessageId?: string }) {
  const db = await requiredDb();
  await db.insert(summaryHistory).values({ summaryJobId: input.jobId, discordUserId: input.discordUserId, headline: input.headline, overview: input.overview, itemCount: input.itemCount, noImportantMail: input.noImportantMail, discordMessageId: input.discordMessageId, deliveredAt: new Date() });
  await db.update(summaryJobs).set({ status: "delivered", deliveredAt: new Date(), completedAt: new Date(), updatedAt: new Date() }).where(eq(summaryJobs.id, input.jobId));
}

export async function failSummaryJob(jobId: number, safeErrorCode: string) {
  const db = await requiredDb();
  await db.update(summaryJobs).set({ status: "failed", lastSafeErrorCode: safeErrorCode.slice(0, 80), completedAt: new Date(), updatedAt: new Date() }).where(eq(summaryJobs.id, jobId));
}

export async function recordAuditEvent(input: { discordUserId?: number; eventType: string; entityType: string; entityId?: string; safeDetail?: string }) {
  const db = await requiredDb();
  await db.insert(auditEvents).values(input);
}
