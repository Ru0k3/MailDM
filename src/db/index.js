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
CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  summary_time TEXT NOT NULL DEFAULT '09:00',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  ai_provider TEXT NOT NULL DEFAULT 'openai',
  ai_model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  ai_api_key TEXT,
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
  const retryClaim = db.prepare(`UPDATE summary_history SET status='processing', attempt_count=attempt_count+1, claimed_at=CURRENT_TIMESTAMP, completed_at=NULL, error_code=NULL WHERE user_id=? AND local_date=? AND delivery_kind='scheduled' AND status='failed' AND delivery_attempted=0 AND attempt_count=1 AND error_code NOT IN ('REAUTH_REQUIRED','NO_ACCOUNT')`);

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
      return db.prepare('SELECT summary_time AS summaryTime, timezone, ai_provider AS aiProvider, ai_model AS aiModel, ai_api_key AS aiApiKey FROM settings WHERE user_id = ?').get(id);
    },
    updateSettings(discordUserId, patch) {
      const id = this.getOrCreateUser(discordUserId);
      const current = this.getSettings(discordUserId);
      const next = { ...current, ...patch };
      db.prepare('UPDATE settings SET summary_time=?, timezone=?, ai_provider=?, ai_model=?, ai_api_key=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(next.summaryTime, next.timezone, next.aiProvider, next.aiModel, next.aiApiKey ?? null, id);
      return this.getSettings(discordUserId);
    },
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
        if (email) {
          const remaining = db.prepare('SELECT COUNT(*) AS count FROM gmail_accounts WHERE user_id=?').get(user.id).count;
          if (remaining === 0) db.prepare('DELETE FROM users WHERE id=?').run(user.id);
        } else db.prepare('DELETE FROM users WHERE id=?').run(user.id);
      });
      tx();
    },
    deleteAllUserData(discordUserId) {
      const user = this.getUser(discordUserId);
      if (user) db.prepare('DELETE FROM users WHERE id=?').run(user.id);
    },
    close() { db.close(); }
  };
}
