import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_user_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS gmail_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_sub TEXT NOT NULL,
  email TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expiry_date INTEGER,
  scopes TEXT NOT NULL,
  reauth_required INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, email)
);
CREATE TABLE IF NOT EXISTS ai_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  label TEXT,
  base_url TEXT NOT NULL,
  encrypted_api_key TEXT NOT NULL,
  cached_models TEXT NOT NULL DEFAULT '[]',
  validated_at TEXT,
  UNIQUE(user_id, provider, base_url)
);
CREATE TABLE IF NOT EXISTS model_choices (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id INTEGER NOT NULL REFERENCES ai_credentials(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  summary_time TEXT NOT NULL DEFAULT '09:00',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  ai_provider TEXT NOT NULL DEFAULT 'openai',
  ai_model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  ai_api_key TEXT,
  active_ai_credential_id INTEGER REFERENCES ai_credentials(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id TEXT,
  rating TEXT NOT NULL CHECK (rating IN ('helpful','not_helpful')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS summary_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date TEXT NOT NULL,
  delivery_kind TEXT NOT NULL CHECK (delivery_kind IN ('scheduled', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('processing', 'complete', 'failed')),
  summary_text TEXT,
  error_code TEXT,
  claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  delivery_attempted INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, local_date, delivery_kind)
);
CREATE TABLE IF NOT EXISTS processed_source_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gmail_account_id INTEGER NOT NULL REFERENCES gmail_accounts(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  first_processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(gmail_account_id, external_id)
);
`;

export function openDatabase(filename = process.env.DATABASE_PATH ?? ':memory:') {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  try { db.exec('ALTER TABLE gmail_accounts ADD COLUMN reauth_required INTEGER NOT NULL DEFAULT 0'); } catch (error) { if (!String(error.message).includes('duplicate column name')) throw error; }
  for (const statement of [
    'ALTER TABLE summary_history ADD COLUMN delivery_attempted INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE summary_history ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0'
  ]) { try { db.exec(statement); } catch (error) { if (!String(error.message).includes('duplicate column name')) throw error; } }
  return db;
}

export function makeStore(db) {
  const ensureUser = db.prepare('INSERT INTO users (discord_user_id) VALUES (?) ON CONFLICT(discord_user_id) DO NOTHING');
  const userId = db.prepare('SELECT id FROM users WHERE discord_user_id = ?');
  const ensureSettings = db.prepare('INSERT INTO settings (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING');
  const claim = db.prepare(`INSERT INTO summary_history (user_id, local_date, delivery_kind, status, attempt_count) VALUES (?, ?, 'scheduled', 'processing', 1) ON CONFLICT(user_id, local_date, delivery_kind) DO NOTHING`);
  const retryClaim = db.prepare(`UPDATE summary_history SET status='processing', attempt_count=attempt_count+1, claimed_at=CURRENT_TIMESTAMP, completed_at=NULL, error_code=NULL WHERE user_id=? AND local_date=? AND delivery_kind='scheduled' AND status='failed' AND delivery_attempted=0 AND attempt_count=1 AND error_code NOT IN ('REAUTH_REQUIRED','NO_ACCOUNT','AI_AUTH_FAILURE')`);

  return {
    getOrCreateUser(discordUserId) {
      ensureUser.run(discordUserId);
      const row = userId.get(discordUserId);
      ensureSettings.run(row.id);
      return row.id;
    },
    getUser(discordUserId) { return userId.get(discordUserId); },
    saveGmailAccount(discordUserId, account) {
      const id = this.getOrCreateUser(discordUserId);
      db.prepare(`INSERT INTO gmail_accounts (user_id, google_sub, email, access_token, refresh_token, expiry_date, scopes, reauth_required)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(user_id, email) DO UPDATE SET google_sub=excluded.google_sub, access_token=excluded.access_token,
        refresh_token=COALESCE(excluded.refresh_token, gmail_accounts.refresh_token), expiry_date=excluded.expiry_date,
        scopes=excluded.scopes, reauth_required=0`)
        .run(id, account.googleSub, account.email, account.accessToken, account.refreshToken ?? null, account.expiryDate ?? null, JSON.stringify(account.scopes ?? []));
    },
    listGmailAccounts(discordUserId) {
      const user = this.getUser(discordUserId);
      if (!user) return [];
      return db.prepare('SELECT id, email, google_sub AS googleSub, access_token AS accessToken, refresh_token AS refreshToken, expiry_date AS expiryDate, scopes, reauth_required AS reauthRequired FROM gmail_accounts WHERE user_id = ? ORDER BY email').all(user.id);
    },
    getSettings(discordUserId) {
      const id = this.getOrCreateUser(discordUserId);
      return db.prepare('SELECT summary_time AS summaryTime, timezone, ai_provider AS aiProvider, ai_model AS aiModel, ai_api_key AS aiApiKey, active_ai_credential_id AS activeAiCredentialId FROM settings WHERE user_id = ?').get(id);
    },
    updateSettings(discordUserId, patch) {
      const id = this.getOrCreateUser(discordUserId);
      const current = this.getSettings(discordUserId);
      const next = { ...current, ...patch };
      db.prepare('UPDATE settings SET summary_time=?, timezone=?, ai_provider=?, ai_model=?, ai_api_key=?, active_ai_credential_id=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(next.summaryTime, next.timezone, next.aiProvider, next.aiModel, next.aiApiKey ?? null, next.activeAiCredentialId ?? null, id);
      return this.getSettings(discordUserId);
    },
    listAiCredentials(discordUserId) {
      const user = this.getUser(discordUserId); if (!user) return [];
      const settings = this.getSettings(discordUserId);
      return db.prepare('SELECT id, provider, label, base_url AS baseUrl, encrypted_api_key AS encryptedApiKey, cached_models AS cachedModels, validated_at AS validatedAt FROM ai_credentials WHERE user_id=? ORDER BY id').all(user.id).map((row) => ({ ...row, cachedModels: JSON.parse(row.cachedModels || '[]'), active: row.id === settings.activeAiCredentialId, activeModel: row.id === settings.activeAiCredentialId ? settings.aiModel : null }));
    },
    saveAiCredential(discordUserId, credential) {
      const id = this.getOrCreateUser(discordUserId);
      db.prepare('INSERT INTO ai_credentials (user_id, provider, label, base_url, encrypted_api_key, cached_models, validated_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(user_id, provider, base_url) DO UPDATE SET label=excluded.label, encrypted_api_key=excluded.encrypted_api_key, cached_models=excluded.cached_models, validated_at=CURRENT_TIMESTAMP').run(id, credential.provider, credential.label ?? null, credential.baseUrl, credential.encryptedApiKey, JSON.stringify(credential.cachedModels ?? []));
      return db.prepare('SELECT id FROM ai_credentials WHERE user_id=? AND provider=? AND base_url=?').get(id, credential.provider, credential.baseUrl).id;
    },
    refreshAiCredentialModels(discordUserId, credentialId, models) { const user = this.getUser(discordUserId); if (!user) return false; return db.prepare('UPDATE ai_credentials SET cached_models=?, validated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?').run(JSON.stringify(models), credentialId, user.id).changes === 1; },
    createModelChoice(discordUserId, credentialId, modelId, expiresMinutes = 15) { const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`; const user = this.getUser(discordUserId); if (!user) throw new Error('user_not_found'); db.prepare("INSERT INTO model_choices (token, user_id, credential_id, model_id, expires_at) VALUES (?, ?, ?, ?, datetime('now', ?))").run(token, user.id, credentialId, modelId, `+${expiresMinutes} minutes`); return token; },
    consumeModelChoice(discordUserId, token) { const user = this.getUser(discordUserId); if (!user) return null; const row = db.prepare("SELECT credential_id AS credentialId, model_id AS modelId FROM model_choices WHERE token=? AND user_id=? AND expires_at>datetime('now')").get(token, user.id); if (!row) return null; db.prepare('DELETE FROM model_choices WHERE token=?').run(token); return row; },
    setActiveAiCredential(discordUserId, credentialId, model) { const user = this.getUser(discordUserId); if (!user || !db.prepare('SELECT id FROM ai_credentials WHERE id=? AND user_id=?').get(credentialId, user.id)) return false; const current = this.getSettings(discordUserId); this.updateSettings(discordUserId, { ...current, activeAiCredentialId: credentialId, aiModel: model }); return true; },
    removeAiCredential(discordUserId, credentialId) { const user = this.getUser(discordUserId); if (!user) return { removed: false }; const current = this.getSettings(discordUserId); const wasActive = Number(current.activeAiCredentialId) === Number(credentialId); const result = db.prepare('DELETE FROM ai_credentials WHERE id=? AND user_id=?').run(credentialId, user.id); if (wasActive) this.updateSettings(discordUserId, { ...current, activeAiCredentialId: null, aiApiKey: null }); return { removed: result.changes === 1, wasActive }; },
    getActiveAiCredential(discordUserId) { const user = this.getUser(discordUserId); if (!user) return null; const settings = this.getSettings(discordUserId); const row = db.prepare('SELECT id, provider, label, base_url AS baseUrl, encrypted_api_key AS encryptedApiKey, cached_models AS cachedModels FROM ai_credentials WHERE id=? AND user_id=?').get(settings.activeAiCredentialId, user.id); return row ? { ...row, cachedModels: JSON.parse(row.cachedModels || '[]'), activeModel: settings.aiModel } : null; },
    recordFeedback(discordUserId, messageId, rating) {
      const id = this.getOrCreateUser(discordUserId);
      db.prepare('INSERT INTO feedback (user_id, message_id, rating) VALUES (?, ?, ?)').run(id, messageId ?? null, rating);
    },
    listScheduledRecipients() {
      return db.prepare(`SELECT u.discord_user_id AS discordUserId, s.summary_time AS summaryTime, s.timezone
        FROM users u JOIN settings s ON s.user_id=u.id
        WHERE EXISTS (SELECT 1 FROM gmail_accounts a WHERE a.user_id=u.id)`).all();
    },
    claimScheduledSummary(discordUserId, localDate) {
      const id = this.getOrCreateUser(discordUserId);
      if (claim.run(id, localDate).changes === 1) return { claimed: true, attempt: 1, retried: false };
      if (retryClaim.run(id, localDate).changes === 1) return { claimed: true, attempt: 2, retried: true };
      return { claimed: false, attempt: 0, retried: false };
    },
    markDeliveryAttempted(discordUserId, localDate) {
      const user = this.getUser(discordUserId);
      if (!user) return;
      db.prepare(`UPDATE summary_history SET delivery_attempted=1 WHERE user_id=? AND local_date=? AND delivery_kind='scheduled' AND status='processing'`).run(user.id, localDate);
    },
    completeScheduledSummary(discordUserId, localDate, summaryText) {
      const user = this.getUser(discordUserId);
      if (!user) return;
      db.prepare(`UPDATE summary_history SET status='complete', summary_text=?, completed_at=CURRENT_TIMESTAMP WHERE user_id=? AND local_date=? AND delivery_kind='scheduled' AND status='processing'`).run(summaryText, user.id, localDate);
    },
    failScheduledSummary(discordUserId, localDate, errorCode, deliveryAttempted = false) {
      const user = this.getUser(discordUserId);
      if (!user) return;
      db.prepare(`UPDATE summary_history SET status='failed', error_code=?, delivery_attempted=CASE WHEN ? THEN 1 ELSE delivery_attempted END, completed_at=CURRENT_TIMESTAMP WHERE user_id=? AND local_date=? AND delivery_kind='scheduled' AND status='processing'`).run(errorCode, deliveryAttempted ? 1 : 0, user.id, localDate);
    },
    markAccountReauthRequired(discordUserId, email) {
      const user = this.getUser(discordUserId);
      if (!user) return;
      db.prepare('UPDATE gmail_accounts SET reauth_required=1 WHERE user_id=? AND email=?').run(user.id, email);
    },
    disconnectAndPurge(discordUserId, email) {
      const user = this.getUser(discordUserId);
      if (!user) return;
      const tx = db.transaction(() => {
        if (email) db.prepare('DELETE FROM gmail_accounts WHERE user_id=? AND email=?').run(user.id, email);
        else db.prepare('DELETE FROM gmail_accounts WHERE user_id=?').run(user.id);
        // /disconnect only removes Gmail data; /delete-my-data owns full-user deletion.

      });
      tx();
    },
    deleteAllUserData(discordUserId) {
      const user = this.getUser(discordUserId);
      if (user) db.prepare('DELETE FROM users WHERE id=?').run(user.id);
    },
    getProcessedExternalIds(gmailAccountId) {
      if (!gmailAccountId) return new Set();
      const rows = db.prepare('SELECT external_id AS externalId FROM processed_source_items WHERE gmail_account_id=?').all(gmailAccountId);
      return new Set(rows.map((row) => row.externalId));
    },
    recordProcessedItems(gmailAccountId, externalIds) {
      if (!gmailAccountId || !externalIds || !externalIds.length) return;
      const insert = db.prepare('INSERT OR IGNORE INTO processed_source_items (gmail_account_id, external_id) VALUES (?, ?)');
      const tx = db.transaction((ids) => {
        for (const id of ids) insert.run(gmailAccountId, id);
      });
      tx(externalIds);
    },
    close() { db.close(); }
  };
}
