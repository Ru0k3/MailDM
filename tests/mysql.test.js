import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { makeMysqlStore, buildPoolConfig } from '../src/db/mysql.js';

const url = process.env.MYSQL_TEST_URL;

test('buildPoolConfig parses SSL params from URI correctly', () => {
  // Non-SSL URI
  const plain = buildPoolConfig('mysql://user:pass@localhost:3306/maildm');
  assert.equal(plain.uri, 'mysql://user:pass@localhost:3306/maildm');
  assert.equal(plain.ssl, undefined);

  // Aiven-style ssl-mode=REQUIRED URI
  const aiven = buildPoolConfig('mysql://user:pass@aiven-host:12345/defaultdb?ssl-mode=REQUIRED');
  assert.equal(aiven.uri, 'mysql://user:pass@aiven-host:12345/defaultdb');
  assert.deepEqual(aiven.ssl, { rejectUnauthorized: false });

  // Strict verification URI
  const verify = buildPoolConfig('mysql://user:pass@aiven-host:12345/defaultdb?ssl-mode=VERIFY_CA');
  assert.equal(verify.uri, 'mysql://user:pass@aiven-host:12345/defaultdb');
  assert.deepEqual(verify.ssl, { rejectUnauthorized: true });
});

test('MySQL/TiDB claim is atomic across two independent store instances', { skip: !url }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const discordUserId = `mysql-test-${suffix}`;
  const storeA = await makeMysqlStore(url);
  const storeB = await makeMysqlStore(url);
  try {
    await storeA.getOrCreateUser(discordUserId);
    await storeA.saveGmailAccount(discordUserId, { googleSub: `sub-${suffix}`, email: `${suffix}@example.com`, accessToken: 'encrypted-access', refreshToken: 'encrypted-refresh', scopes: ['https://www.googleapis.com/auth/gmail.readonly'] });
    const claims = await Promise.all([
      storeA.claimScheduledSummary(discordUserId, '2099-01-02'),
      storeB.claimScheduledSummary(discordUserId, '2099-01-02')
    ]);
    assert.equal(claims.filter((claim) => claim.claimed).length, 1);
    const verification = await mysql.createConnection(buildPoolConfig(url));
    const [rows] = await verification.query('SELECT COUNT(*) AS count FROM summary_history h JOIN users u ON u.id=h.user_id WHERE u.discord_user_id=? AND h.local_date=?', [discordUserId, '2099-01-02']);
    assert.equal(Number(rows[0].count), 1);
    await verification.end();
  } finally {
    await storeA.deleteAllUserData(discordUserId);
    await storeA.close();
    await storeB.close();
  }
});

test('MySQL/TiDB disconnect preserves non-Gmail data and delete cascades it', { skip: !url }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const discordUserId = `mysql-purge-${suffix}`;
  const store = await makeMysqlStore(url);
  const connection = await mysql.createConnection(buildPoolConfig(url));
  try {
    await store.getOrCreateUser(discordUserId);
    await store.saveGmailAccount(discordUserId, { googleSub: `sub-${suffix}`, email: `${suffix}@example.com`, accessToken: 'encrypted-access', refreshToken: 'encrypted-refresh', scopes: ['https://www.googleapis.com/auth/gmail.readonly'] });
    const [users] = await connection.query('SELECT id FROM users WHERE discord_user_id=?', [discordUserId]);
    const userId = users[0].id;
    await connection.query("INSERT INTO feedback (user_id, message_id, rating) VALUES (?, 'm1', 'helpful')", [userId]);
    await connection.query("INSERT INTO summary_history (user_id, local_date, delivery_kind, status, summary_text, attempt_count) VALUES (?, '2099-01-03', 'scheduled', 'complete', 'past brief', 1)", [userId]);
    await store.disconnectAndPurge(discordUserId, `${suffix}@example.com`);
    const [preserved] = await connection.query('SELECT (SELECT COUNT(*) FROM users WHERE id=?) AS users, (SELECT COUNT(*) FROM settings WHERE user_id=?) AS settings, (SELECT COUNT(*) FROM summary_history WHERE user_id=?) AS history, (SELECT COUNT(*) FROM feedback WHERE user_id=?) AS feedback, (SELECT COUNT(*) FROM gmail_accounts WHERE user_id=?) AS gmail', [userId, userId, userId, userId, userId]);
    assert.deepEqual(Object.fromEntries(Object.entries(preserved[0]).map(([key, value]) => [key, Number(value)])), { users: 1, settings: 1, history: 1, feedback: 1, gmail: 0 });
    await store.deleteAllUserData(discordUserId);
    const [deleted] = await connection.query('SELECT (SELECT COUNT(*) FROM users WHERE id=?) AS users, (SELECT COUNT(*) FROM settings WHERE user_id=?) AS settings, (SELECT COUNT(*) FROM summary_history WHERE user_id=?) AS history, (SELECT COUNT(*) FROM feedback WHERE user_id=?) AS feedback', [userId, userId, userId, userId]);
    assert.deepEqual(Object.fromEntries(Object.entries(deleted[0]).map(([key, value]) => [key, Number(value)])), { users: 0, settings: 0, history: 0, feedback: 0 });
  } finally {
    await connection.end();
    await store.close();
  }
});
