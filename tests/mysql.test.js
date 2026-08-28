import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { makeMysqlStore } from '../src/db/mysql.js';

const url = process.env.MYSQL_TEST_URL;

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
    const verification = await mysql.createConnection(url);
    const [rows] = await verification.query('SELECT COUNT(*) AS count FROM summary_history h JOIN users u ON u.id=h.user_id WHERE u.discord_user_id=? AND h.local_date=?', [discordUserId, '2099-01-02']);
    assert.equal(Number(rows[0].count), 1);
    await verification.end();
  } finally {
    await storeA.deleteAllUserData(discordUserId);
    await storeA.close();
    await storeB.close();
  }
});
