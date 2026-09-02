import mysql from 'mysql2/promise';
import crypto from 'node:crypto';

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, discord_user_id VARCHAR(64) NOT NULL UNIQUE, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS gmail_accounts (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL, google_sub VARCHAR(255) NOT NULL, email VARCHAR(320) NOT NULL, access_token TEXT NOT NULL, refresh_token TEXT NULL, expiry_date BIGINT NULL, scopes TEXT NOT NULL, reauth_required TINYINT(1) NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_gmail_user_email (user_id, email), CONSTRAINT fk_gmail_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS ai_credentials (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL, provider VARCHAR(32) NOT NULL, label VARCHAR(120) NULL, base_url VARCHAR(500) NOT NULL, encrypted_api_key TEXT NOT NULL, cached_models JSON NOT NULL, validated_at TIMESTAMP NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uq_ai_credential_user_provider_url (user_id, provider, base_url), CONSTRAINT fk_ai_credentials_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS model_choices (token CHAR(43) NOT NULL PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL, credential_id BIGINT UNSIGNED NOT NULL, choice_type ENUM('model','credential') NOT NULL, model_id VARCHAR(255) NULL, expires_at TIMESTAMP NOT NULL, CONSTRAINT fk_model_choices_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, CONSTRAINT fk_model_choices_credential FOREIGN KEY (credential_id) REFERENCES ai_credentials(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS settings (user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY, summary_time CHAR(5) NOT NULL DEFAULT '09:00', timezone VARCHAR(100) NOT NULL DEFAULT 'UTC', ai_provider VARCHAR(32) NOT NULL DEFAULT 'openai', ai_model VARCHAR(120) NOT NULL DEFAULT 'gpt-4o-mini', ai_api_key TEXT NULL, active_ai_credential_id BIGINT UNSIGNED NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, CONSTRAINT fk_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, CONSTRAINT fk_settings_active_credential FOREIGN KEY (active_ai_credential_id) REFERENCES ai_credentials(id) ON DELETE SET NULL) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS feedback (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL, message_id VARCHAR(128) NULL, rating ENUM('helpful','not_helpful') NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_feedback_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS summary_history (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL, local_date DATE NOT NULL, delivery_kind ENUM('scheduled','manual') NOT NULL, status ENUM('processing','complete','failed') NOT NULL, summary_text TEXT NULL, error_code VARCHAR(64) NULL, claimed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TIMESTAMP NULL, delivery_attempted TINYINT(1) NOT NULL DEFAULT 0, attempt_count INT NOT NULL DEFAULT 0, UNIQUE KEY uq_summary_claim (user_id, local_date, delivery_kind), CONSTRAINT fk_history_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS processed_source_items (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, gmail_account_id BIGINT UNSIGNED NOT NULL, external_id VARCHAR(255) NOT NULL, first_processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_processed_account_external (gmail_account_id, external_id), CONSTRAINT fk_processed_gmail_account FOREIGN KEY (gmail_account_id) REFERENCES gmail_accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`
];

function parseModels(value) { try { return Array.isArray(value) ? value : JSON.parse(value || '[]'); } catch { return []; } }

export function buildPoolConfig(connectionString) {
  let uri = connectionString;
  let ssl;

  try {
    const parsed = new URL(connectionString);
    const sslMode = (parsed.searchParams.get('ssl-mode') || parsed.searchParams.get('sslmode') || '').toUpperCase();
    const sslParam = parsed.searchParams.get('ssl');
    const envSsl = process.env.MYSQL_SSL === 'true';

    if (sslMode || sslParam || envSsl) {
      parsed.searchParams.delete('ssl-mode');
      parsed.searchParams.delete('sslmode');
      parsed.searchParams.delete('ssl');
      uri = parsed.toString();

      let rejectUnauthorized = false;
      if (process.env.MYSQL_SSL_REJECT_UNAUTHORIZED === 'true' || ['VERIFY_CA', 'VERIFY_IDENTITY'].includes(sslMode)) {
        rejectUnauthorized = true;
      }

      ssl = { rejectUnauthorized };
      if (process.env.MYSQL_CA) {
        ssl.ca = process.env.MYSQL_CA;
      }
    }
  } catch {
    // If not a valid URL string, pass unchanged
  }

  return { uri, ...(ssl ? { ssl } : {}) };
}

export async function makeMysqlStore(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required for the production database');
  const poolConfig = buildPoolConfig(connectionString);
  const pool = mysql.createPool({ ...poolConfig, waitForConnections: true, connectionLimit: 5, queueLimit: 0, timezone: 'Z' });
  for (const statement of schemaStatements) await pool.query(statement);
  try { await pool.query('ALTER TABLE settings ADD COLUMN active_ai_credential_id BIGINT UNSIGNED NULL'); } catch (error) { if (!/duplicate|exists/i.test(error.message)) throw error; }
  try { await pool.query('ALTER TABLE settings ADD CONSTRAINT fk_settings_active_credential FOREIGN KEY (active_ai_credential_id) REFERENCES ai_credentials(id) ON DELETE SET NULL'); } catch (error) { if (!/duplicate|exists|already has/i.test(error.message)) throw error; }
  // One-time startup bridge for all legacy single-key users. Legacy ciphertext is copied as-is;
  // no plaintext key is loaded into application memory or written to logs.
  async function migrateLegacyCredentials() {
    const [legacyRows] = await pool.query(`SELECT s.user_id AS userId, s.ai_provider AS provider, s.ai_model AS model, s.ai_api_key AS encryptedApiKey
      FROM settings s LEFT JOIN ai_credentials c ON c.user_id=s.user_id
      WHERE s.ai_api_key IS NOT NULL AND c.id IS NULL`);
    for (const legacy of legacyRows) {
      const baseUrl = legacy.provider === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1';
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [result] = await connection.query('INSERT INTO ai_credentials (user_id, provider, label, base_url, encrypted_api_key, cached_models, validated_at) VALUES (?, ?, NULL, ?, ?, ?, CURRENT_TIMESTAMP)', [legacy.userId, legacy.provider || 'openai', baseUrl, legacy.encryptedApiKey, JSON.stringify(legacy.model ? [{ id: legacy.model }] : [])]);
        await connection.query('UPDATE settings SET active_ai_credential_id=? WHERE user_id=? AND active_ai_credential_id IS NULL', [result.insertId, legacy.userId]);
        await connection.commit();
      } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    }
  }
  await migrateLegacyCredentials();

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

  async function getCredentialRows(userId) {
    const [rows] = await pool.query('SELECT id, provider, label, base_url AS baseUrl, encrypted_api_key AS encryptedApiKey, cached_models AS cachedModels, validated_at AS validatedAt FROM ai_credentials WHERE user_id=? ORDER BY provider, label, id', [userId]);
    return rows.map((row) => ({ ...row, cachedModels: parseModels(row.cachedModels) }));
  }

  return {
    async getOrCreateUser(discordUserId) { const connection = await pool.getConnection(); try { return await getUserId(connection, discordUserId); } finally { connection.release(); } },
    async getUser(discordUserId) { const [rows] = await pool.query('SELECT id FROM users WHERE discord_user_id=?', [discordUserId]); return rows[0] ?? undefined; },
    async saveGmailAccount(discordUserId, account) {
      const connection = await pool.getConnection(); try { const id = await getUserId(connection, discordUserId); await connection.query(`INSERT INTO gmail_accounts (user_id, google_sub, email, access_token, refresh_token, expiry_date, scopes, reauth_required) VALUES (?, ?, ?, ?, ?, ?, ?, 0) ON DUPLICATE KEY UPDATE google_sub=VALUES(google_sub), access_token=VALUES(access_token), refresh_token=COALESCE(VALUES(refresh_token), refresh_token), expiry_date=VALUES(expiry_date), scopes=VALUES(scopes), reauth_required=0`, [id, account.googleSub, account.email, account.accessToken, account.refreshToken ?? null, account.expiryDate ?? null, JSON.stringify(account.scopes ?? [])]); } finally { connection.release(); }
    },
    async listGmailAccounts(discordUserId) { const user = await this.getUser(discordUserId); if (!user) return []; const [rows] = await pool.query('SELECT id, email, google_sub AS googleSub, access_token AS accessToken, refresh_token AS refreshToken, expiry_date AS expiryDate, scopes, reauth_required AS reauthRequired FROM gmail_accounts WHERE user_id=? ORDER BY email', [user.id]); return rows; },
    async getSettings(discordUserId) { const connection = await pool.getConnection(); try { const id = await getUserId(connection, discordUserId); const [rows] = await connection.query('SELECT summary_time AS summaryTime, timezone, ai_provider AS aiProvider, ai_model AS aiModel, ai_api_key AS aiApiKey, active_ai_credential_id AS activeAiCredentialId FROM settings WHERE user_id=?', [id]); return rows[0]; } finally { connection.release(); } },
    async updateSettings(discordUserId, patch) { const connection = await pool.getConnection(); try { const id = await getUserId(connection, discordUserId); const [currentRows] = await connection.query('SELECT summary_time AS summaryTime, timezone, ai_provider AS aiProvider, ai_model AS aiModel, ai_api_key AS aiApiKey, active_ai_credential_id AS activeAiCredentialId FROM settings WHERE user_id=?', [id]); const next = { ...currentRows[0], ...patch }; await connection.query('UPDATE settings SET summary_time=?, timezone=?, ai_provider=?, ai_model=?, ai_api_key=?, active_ai_credential_id=? WHERE user_id=?', [next.summaryTime, next.timezone, next.aiProvider, next.aiModel, next.aiApiKey ?? null, next.activeAiCredentialId ?? null, id]); return next; } finally { connection.release(); } },
    async listAiCredentials(discordUserId) { const user = await this.getUser(discordUserId); if (!user) return []; const credentials = await getCredentialRows(user.id); const [settingsRows] = await pool.query('SELECT active_ai_credential_id AS activeAiCredentialId, ai_model AS activeModel FROM settings WHERE user_id=?', [user.id]); const activeId = settingsRows[0]?.activeAiCredentialId ?? null; return credentials.map((credential) => ({ ...credential, active: Number(credential.id) === Number(activeId), activeModel: Number(credential.id) === Number(activeId) ? settingsRows[0]?.activeModel : null })); },
    async saveAiCredential(discordUserId, credential) { const user = await this.getUser(discordUserId); if (!user) throw new Error('user_not_found'); await pool.query('INSERT INTO ai_credentials (user_id, provider, label, base_url, encrypted_api_key, cached_models, validated_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE label=VALUES(label), encrypted_api_key=VALUES(encrypted_api_key), cached_models=VALUES(cached_models), validated_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP', [user.id, credential.provider, credential.label ?? null, credential.baseUrl, credential.encryptedApiKey, JSON.stringify(credential.cachedModels ?? [])]); const [rows] = await pool.query('SELECT id FROM ai_credentials WHERE user_id=? AND provider=? AND base_url=?', [user.id, credential.provider, credential.baseUrl]); return rows[0]?.id; },
    async createModelChoice(discordUserId, credentialId, modelId, expiresMinutes = 15) { const user = await this.getUser(discordUserId); if (!user) throw new Error('user_not_found'); const token = crypto.randomBytes(32).toString('base64url'); await pool.query("INSERT INTO model_choices (token, user_id, credential_id, choice_type, model_id, expires_at) VALUES (?, ?, ?, 'model', ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? MINUTE))", [token, user.id, credentialId, modelId, expiresMinutes]); return token; },
    async createCredentialChoice(discordUserId, credentialId, expiresMinutes = 15) { const user = await this.getUser(discordUserId); if (!user) throw new Error('user_not_found'); const token = crypto.randomBytes(32).toString('base64url'); await pool.query("INSERT INTO model_choices (token, user_id, credential_id, choice_type, model_id, expires_at) VALUES (?, ?, ?, 'credential', NULL, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? MINUTE))", [token, user.id, credentialId, expiresMinutes]); return token; },
    async consumeModelChoice(discordUserId, token) { const user = await this.getUser(discordUserId); if (!user) return null; const connection = await pool.getConnection(); try { await connection.beginTransaction(); const [rows] = await connection.query("SELECT credential_id AS credentialId, model_id AS modelId, choice_type AS choiceType FROM model_choices WHERE token=? AND user_id=? AND choice_type='model' AND expires_at>CURRENT_TIMESTAMP FOR UPDATE", [token, user.id]); if (!rows[0]) { await connection.rollback(); return null; } await connection.query('DELETE FROM model_choices WHERE token=?', [token]); await connection.commit(); return rows[0]; } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); } },
    async consumeCredentialChoice(discordUserId, token) { const user = await this.getUser(discordUserId); if (!user) return null; const connection = await pool.getConnection(); try { await connection.beginTransaction(); const [rows] = await connection.query("SELECT credential_id AS credentialId FROM model_choices WHERE token=? AND user_id=? AND choice_type='credential' AND expires_at>CURRENT_TIMESTAMP FOR UPDATE", [token, user.id]); if (!rows[0]) { await connection.rollback(); return null; } await connection.query('DELETE FROM model_choices WHERE token=?', [token]); await connection.commit(); return rows[0]; } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); } },
    async refreshAiCredentialModels(discordUserId, credentialId, models) { const user = await this.getUser(discordUserId); if (!user) return false; const [result] = await pool.query('UPDATE ai_credentials SET cached_models=?, validated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?', [JSON.stringify(models), credentialId, user.id]); return result.affectedRows > 0; },
    async setActiveAiCredential(discordUserId, credentialId, model) { const user = await this.getUser(discordUserId); if (!user) throw new Error('user_not_found'); const [rows] = await pool.query('SELECT provider FROM ai_credentials WHERE id=? AND user_id=?', [credentialId, user.id]); if (!rows[0]) return false; await pool.query('UPDATE settings SET active_ai_credential_id=?, ai_provider=?, ai_model=? WHERE user_id=?', [credentialId, rows[0].provider, model, user.id]); return true; },
    async removeAiCredential(discordUserId, credentialId) { const user = await this.getUser(discordUserId); if (!user) return { removed: false }; const connection = await pool.getConnection(); try { await connection.beginTransaction(); const [rows] = await connection.query('SELECT id FROM ai_credentials WHERE id=? AND user_id=? FOR UPDATE', [credentialId, user.id]); if (!rows[0]) { await connection.rollback(); return { removed: false, wasActive: false }; } const [activeRows] = await connection.query('SELECT active_ai_credential_id AS activeId FROM settings WHERE user_id=? FOR UPDATE', [user.id]); const wasActive = Number(activeRows[0]?.activeId) === Number(credentialId); await connection.query('DELETE FROM ai_credentials WHERE id=? AND user_id=?', [credentialId, user.id]); if (wasActive) await connection.query("UPDATE settings SET active_ai_credential_id=NULL, ai_provider='openai', ai_model='gpt-4o-mini', ai_api_key=NULL WHERE user_id=?", [user.id]); await connection.commit(); return { removed: true, wasActive }; } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); } },
    async getActiveAiCredential(discordUserId) { const credentials = await this.listAiCredentials(discordUserId); const active = credentials.find((credential) => credential.active); return active ? { ...active, activeModel: active.activeModel } : null; },
    async recordFeedback(discordUserId, messageId, rating) { const connection = await pool.getConnection(); try { const id = await getUserId(connection, discordUserId); await connection.query('INSERT INTO feedback (user_id, message_id, rating) VALUES (?, ?, ?)', [id, messageId ?? null, rating]); } finally { connection.release(); } },
    async listScheduledRecipients() { const [rows] = await pool.query(`SELECT u.discord_user_id AS discordUserId, s.summary_time AS summaryTime, s.timezone FROM users u JOIN settings s ON s.user_id=u.id WHERE EXISTS (SELECT 1 FROM gmail_accounts a WHERE a.user_id=u.id)`); return rows; },
    async claimScheduledSummary(discordUserId, localDate) { const connection = await pool.getConnection(); try { await connection.beginTransaction(); const id = await getUserId(connection, discordUserId); const [rows] = await connection.query("SELECT id, status, attempt_count, delivery_attempted, error_code FROM summary_history WHERE user_id=? AND local_date=? AND delivery_kind='scheduled' FOR UPDATE", [id, localDate]); const row = rows[0]; if (!row) { await connection.query("INSERT INTO summary_history (user_id, local_date, delivery_kind, status, attempt_count) VALUES (?, ?, 'scheduled', 'processing', 1)", [id, localDate]); await connection.commit(); return { claimed: true, attempt: 1, retried: false }; } const retryable = row.status === 'failed' && row.attempt_count === 1 && row.delivery_attempted === 0 && !['REAUTH_REQUIRED', 'NO_ACCOUNT', 'AI_AUTH_FAILURE'].includes(row.error_code); if (retryable) { await connection.query("UPDATE summary_history SET status='processing', attempt_count=2, claimed_at=CURRENT_TIMESTAMP, completed_at=NULL, error_code=NULL WHERE id=?", [row.id]); await connection.commit(); return { claimed: true, attempt: 2, retried: true }; } await connection.commit(); return { claimed: false, attempt: 0, retried: false }; } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); } },
    async markDeliveryAttempted(discordUserId, localDate) { const user = await this.getUser(discordUserId); if (user) await pool.query("UPDATE summary_history SET delivery_attempted=1 WHERE user_id=? AND local_date=? AND delivery_kind='scheduled' AND status='processing'", [user.id, localDate]); },
    async completeScheduledSummary(discordUserId, localDate, summaryText) { const user = await this.getUser(discordUserId); if (user) await pool.query("UPDATE summary_history SET status='complete', summary_text=?, completed_at=CURRENT_TIMESTAMP WHERE user_id=? AND local_date=? AND delivery_kind='scheduled' AND status='processing'", [summaryText, user.id, localDate]); },
    async failScheduledSummary(discordUserId, localDate, errorCode, deliveryAttempted = false) { const user = await this.getUser(discordUserId); if (user) await pool.query("UPDATE summary_history SET status='failed', error_code=?, delivery_attempted=CASE WHEN ? THEN 1 ELSE delivery_attempted END, completed_at=CURRENT_TIMESTAMP WHERE user_id=? AND local_date=? AND delivery_kind='scheduled' AND status='processing'", [errorCode, deliveryAttempted ? 1 : 0, user.id, localDate]); },
    async markAccountReauthRequired(discordUserId, email) { const user = await this.getUser(discordUserId); if (user) await pool.query('UPDATE gmail_accounts SET reauth_required=1 WHERE user_id=? AND email=?', [user.id, email]); },
    async disconnectAndPurge(discordUserId, email) { const user = await this.getUser(discordUserId); if (!user) return; const connection = await pool.getConnection(); try { await connection.beginTransaction(); if (email) await connection.query('DELETE FROM gmail_accounts WHERE user_id=? AND email=?', [user.id, email]); else await connection.query('DELETE FROM gmail_accounts WHERE user_id=?', [user.id]); await connection.commit(); } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); } },
    async getProcessedExternalIds(gmailAccountId) {
      if (!gmailAccountId) return new Set();
      const [rows] = await pool.query('SELECT external_id AS externalId FROM processed_source_items WHERE gmail_account_id=?', [gmailAccountId]);
      return new Set(rows.map((row) => row.externalId));
    },
    async recordProcessedItems(gmailAccountId, externalIds) {
      if (!gmailAccountId || !externalIds || !externalIds.length) return;
      const values = externalIds.map((id) => [gmailAccountId, id]);
      await pool.query('INSERT IGNORE INTO processed_source_items (gmail_account_id, external_id) VALUES ?', [values]);
    },
    async deleteAllUserData(discordUserId) { const user = await this.getUser(discordUserId); if (user) await pool.query('DELETE FROM users WHERE id=?', [user.id]); },
    async close() { await pool.end(); }
  };
}
