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
`;

export function openDatabase(filename = process.env.DATABASE_PATH ?? ':memory:') {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  return db;
}

export function makeStore(db) {
  const ensureUser = db.prepare('INSERT INTO users (discord_user_id) VALUES (?) ON CONFLICT(discord_user_id) DO NOTHING');
  const userId = db.prepare('SELECT id FROM users WHERE discord_user_id = ?');
  const ensureSettings = db.prepare('INSERT INTO settings (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING');

  return {
    getOrCreateUser(discordUserId) {
      ensureUser.run(discordUserId);
      const row = userId.get(discordUserId);
      ensureSettings.run(row.id);
      return row.id;
    },
    getUser(discordUserId) {
      return userId.get(discordUserId);
    },
    saveGmailAccount(discordUserId, account) {
      const id = this.getOrCreateUser(discordUserId);
      db.prepare(`INSERT INTO gmail_accounts (user_id, google_sub, email, access_token, refresh_token, expiry_date, scopes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, email) DO UPDATE SET google_sub=excluded.google_sub, access_token=excluded.access_token,
        refresh_token=COALESCE(excluded.refresh_token, gmail_accounts.refresh_token), expiry_date=excluded.expiry_date, scopes=excluded.scopes`)
        .run(id, account.googleSub, account.email, account.accessToken, account.refreshToken ?? null, account.expiryDate ?? null, JSON.stringify(account.scopes ?? []));
    },
    listGmailAccounts(discordUserId) {
      const user = this.getUser(discordUserId);
      if (!user) return [];
      return db.prepare('SELECT id, email, google_sub AS googleSub, access_token AS accessToken, refresh_token AS refreshToken, expiry_date AS expiryDate, scopes FROM gmail_accounts WHERE user_id = ? ORDER BY email').all(user.id);
    },
    getSettings(discordUserId) {
      const id = this.getOrCreateUser(discordUserId);
      return db.prepare('SELECT summary_time AS summaryTime, timezone, ai_provider AS aiProvider, ai_model AS aiModel, ai_api_key AS aiApiKey FROM settings WHERE user_id = ?').get(id);
    },
    updateSettings(discordUserId, patch) {
      const id = this.getOrCreateUser(discordUserId);
      const current = this.getSettings(discordUserId);
      const next = { ...current, ...patch };
      db.prepare(`UPDATE settings SET summary_time=?, timezone=?, ai_provider=?, ai_model=?, ai_api_key=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?`)
        .run(next.summaryTime, next.timezone, next.aiProvider, next.aiModel, next.aiApiKey ?? null, id);
      return this.getSettings(discordUserId);
    },
    recordFeedback(discordUserId, messageId, rating) {
      const id = this.getOrCreateUser(discordUserId);
      db.prepare('INSERT INTO feedback (user_id, message_id, rating) VALUES (?, ?, ?)').run(id, messageId ?? null, rating);
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
