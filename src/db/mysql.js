import mysql from 'mysql2/promise';

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, discord_user_id VARCHAR(64) NOT NULL UNIQUE, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS gmail_accounts (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL, google_sub VARCHAR(255) NOT NULL, email VARCHAR(320) NOT NULL, access_token TEXT NOT NULL, refresh_token TEXT NULL, expiry_date BIGINT NULL, scopes TEXT NOT NULL, reauth_required TINYINT(1) NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_gmail_user_email (user_id, email), CONSTRAINT fk_gmail_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS settings (user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY, summary_time CHAR(5) NOT NULL DEFAULT '09:00', timezone VARCHAR(100) NOT NULL DEFAULT 'UTC', ai_provider VARCHAR(32) NOT NULL DEFAULT 'openai', ai_model VARCHAR(120) NOT NULL DEFAULT 'gpt-4o-mini', ai_api_key TEXT NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, CONSTRAINT fk_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS feedback (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL, message_id VARCHAR(128) NULL, rating ENUM('helpful','not_helpful') NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_feedback_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS summary_history (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL, local_date DATE NOT NULL, delivery_kind ENUM('scheduled','manual') NOT NULL, status ENUM('processing','complete','failed') NOT NULL, summary_text TEXT NULL, error_code VARCHAR(64) NULL, claimed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TIMESTAMP NULL, delivery_attempted TINYINT(1) NOT NULL DEFAULT 0, attempt_count INT NOT NULL DEFAULT 0, UNIQUE KEY uq_summary_claim (user_id, local_date, delivery_kind), CONSTRAINT fk_history_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB`
];

export async function makeMysqlStore(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required for the production database');
  const pool = mysql.createPool({ uri: connectionString, waitForConnections: true, connectionLimit: 5, queueLimit: 0, timezone: 'Z' });
  for (const statement of schemaStatements) await pool.query(statement);

  async function getUserId(connection, discordUserId, create = true) {
    if (create) {
      await connection.query('INSERT INTO users (discord_user_id) VALUES (?) ON DUPLICATE KEY UPDATE discord_user_id=VALUES(discord_user_id)', [discordUserId]);
      const [userRows] = await connection.query('SELECT id FROM users WHERE discord_user_id=?', [discordUserId]);
      const id = userRows[0]?.id;
      await connection.query('INSERT INTO settings (user_id) VALUES (?) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id)', [id]);
      return id;
    }
    const [rows] = await connection.query('SELECT id FROM users WHERE discord_user_id=?', [discordUserId]);
    return rows[0]?.id ?? null;
  }

  return {
    async getOrCreateUser(discordUserId) { const connection = await pool.getConnection(); try { return await getUserId(connection, discordUserId); } finally { connection.release(); } },
    async getUser(discordUserId) { const [rows] = await pool.query('SELECT id FROM users WHERE discord_user_id=?', [discordUserId]); return rows[0] ?? undefined; },
    async saveGmailAccount(discordUserId, account) {
      const connection = await pool.getConnection();
      try {
        const id = await getUserId(connection, discordUserId);
        await connection.query(`INSERT INTO gmail_accounts (user_id, google_sub, email, access_token, refresh_token, expiry_date, scopes, reauth_required) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
          ON DUPLICATE KEY UPDATE google_sub=VALUES(google_sub), access_token=VALUES(access_token), refresh_token=COALESCE(VALUES(refresh_token), refresh_token), expiry_date=VALUES(expiry_date), scopes=VALUES(scopes), reauth_required=0`, [id, account.googleSub, account.email, account.accessToken, account.refreshToken ?? null, account.expiryDate ?? null, JSON.stringify(account.scopes ?? [])]);
      } finally { connection.release(); }
    },
    async listGmailAccounts(discordUserId) {
      const user = await this.getUser(discordUserId); if (!user) return [];
      const [rows] = await pool.query('SELECT id, email, google_sub AS googleSub, access_token AS accessToken, refresh_token AS refreshToken, expiry_date AS expiryDate, scopes, reauth_required AS reauthRequired FROM gmail_accounts WHERE user_id=? ORDER BY email', [user.id]); return rows;
    },
    async getSettings(discordUserId) {
      const connection = await pool.getConnection(); try { const id = await getUserId(connection, discordUserId); const [rows] = await connection.query('SELECT summary_time AS summaryTime, timezone, ai_provider AS aiProvider, ai_model AS aiModel, ai_api_key AS aiApiKey FROM settings WHERE user_id=?', [id]); return rows[0]; } finally { connection.release(); }
    },
    async updateSettings(discordUserId, patch) {
      const connection = await pool.getConnection(); try { const id = await getUserId(connection, discordUserId); const [currentRows] = await connection.query('SELECT summary_time AS summaryTime, timezone, ai_provider AS aiProvider, ai_model AS aiModel, ai_api_key AS aiApiKey FROM settings WHERE user_id=?', [id]); const next = { ...currentRows[0], ...patch }; await connection.query('UPDATE settings SET summary_time=?, timezone=?, ai_provider=?, ai_model=?, ai_api_key=? WHERE user_id=?', [next.summaryTime, next.timezone, next.aiProvider, next.aiModel, next.aiApiKey ?? null, id]); return next; } finally { connection.release(); }
    },
    async recordFeedback(discordUserId, messageId, rating) { const connection = await pool.getConnection(); try { const id = await getUserId(connection, discordUserId); await connection.query('INSERT INTO feedback (user_id, message_id, rating) VALUES (?, ?, ?)', [id, messageId ?? null, rating]); } finally { connection.release(); } },
    async listScheduledRecipients() { const [rows] = await pool.query(`SELECT u.discord_user_id AS discordUserId, s.summary_time AS summaryTime, s.timezone FROM users u JOIN settings s ON s.user_id=u.id WHERE EXISTS (SELECT 1 FROM gmail_accounts a WHERE a.user_id=u.id)`); return rows; },
    async claimScheduledSummary(discordUserId, localDate) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const id = await getUserId(connection, discordUserId);
        const [rows] = await connection.query("SELECT id, status, attempt_count, delivery_attempted, error_code FROM summary_history WHERE user_id=? AND local_date=? AND delivery_kind='scheduled' FOR UPDATE", [id, localDate]);
        const row = rows[0];
        if (!row) { await connection.query("INSERT INTO summary_history (user_id, local_date, delivery_kind, status, attempt_count) VALUES (?, ?, 'scheduled', 'processing', 1)", [id, localDate]); await connection.commit(); return { claimed: true, attempt: 1, retried: false }; }
        const retryable = row?.status === 'failed' && row.attempt_count === 1 && row.delivery_attempted === 0 && !['REAUTH_REQUIRED', 'NO_ACCOUNT', 'AI_AUTH_FAILURE'].includes(row.error_code);
        if (retryable) { await connection.query("UPDATE summary_history SET status='processing', attempt_count=2, claimed_at=CURRENT_TIMESTAMP, completed_at=NULL, error_code=NULL WHERE id=?", [row.id]); await connection.commit(); return { claimed: true, attempt: 2, retried: true }; }
        await connection.commit(); return { claimed: false, attempt: 0, retried: false };
      } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    },
    async markDeliveryAttempted(discordUserId, localDate) { const user = await this.getUser(discordUserId); if (user) await pool.query("UPDATE summary_history SET delivery_attempted=1 WHERE user_id=? AND local_date=? AND delivery_kind='scheduled' AND status='processing'", [user.id, localDate]); },
    async completeScheduledSummary(discordUserId, localDate, summaryText) { const user = await this.getUser(discordUserId); if (user) await pool.query("UPDATE summary_history SET status='complete', summary_text=?, completed_at=CURRENT_TIMESTAMP WHERE user_id=? AND local_date=? AND delivery_kind='scheduled' AND status='processing'", [summaryText, user.id, localDate]); },
    async failScheduledSummary(discordUserId, localDate, errorCode, deliveryAttempted = false) { const user = await this.getUser(discordUserId); if (user) await pool.query("UPDATE summary_history SET status='failed', error_code=?, delivery_attempted=CASE WHEN ? THEN 1 ELSE delivery_attempted END, completed_at=CURRENT_TIMESTAMP WHERE user_id=? AND local_date=? AND delivery_kind='scheduled' AND status='processing'", [errorCode, deliveryAttempted ? 1 : 0, user.id, localDate]); },
    async markAccountReauthRequired(discordUserId, email) { const user = await this.getUser(discordUserId); if (user) await pool.query('UPDATE gmail_accounts SET reauth_required=1 WHERE user_id=? AND email=?', [user.id, email]); },
    async disconnectAndPurge(discordUserId, email) { const user = await this.getUser(discordUserId); if (!user) return; const connection = await pool.getConnection(); try { await connection.beginTransaction(); if (email) await connection.query('DELETE FROM gmail_accounts WHERE user_id=? AND email=?', [user.id, email]); else await connection.query('DELETE FROM gmail_accounts WHERE user_id=?', [user.id]); await connection.commit(); } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); } },
    async deleteAllUserData(discordUserId) { const user = await this.getUser(discordUserId); if (user) await pool.query('DELETE FROM users WHERE id=?', [user.id]); },
    async close() { await pool.end(); }
  };
}
