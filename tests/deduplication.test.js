import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, makeStore } from '../src/db/index.js';
import { makeMysqlStore } from '../src/db/mysql.js';
import { runSummaryForUser, PipelineError } from '../src/summarizer/pipeline.js';
import { SummaryScheduler } from '../src/scheduler/index.js';
import { encryptSecret } from '../src/security/index.js';
import { handleInteraction } from '../src/discord/commands.js';

const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const env = { SESSION_SECRET: 'test-session-secret-32-chars-long!!', SCHEDULER_SECRET: 'test-scheduler-secret' };

function setupUserWithKey(store, discordUserId = 'dedup-user') {
  store.getOrCreateUser(discordUserId);
  store.saveGmailAccount(discordUserId, {
    googleSub: 'sub-dedup',
    email: 'dedup@example.com',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    scopes: [GMAIL_READONLY_SCOPE]
  });
  store.saveAiCredential(discordUserId, {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    encryptedApiKey: encryptSecret('sk-test-mock-key-1234567890', env.SESSION_SECRET),
    cachedModels: [{ id: 'gpt-4o-mini' }]
  });
  const creds = store.listAiCredentials(discordUserId);
  store.setActiveAiCredential(discordUserId, creds[0].id, 'gpt-4o-mini');
  return discordUserId;
}

test('SQLite store records and retrieves processed external IDs', async () => {
  const db = openDatabase();
  const store = makeStore(db);
  const discordUserId = 'store-test-user';
  store.getOrCreateUser(discordUserId);
  store.saveGmailAccount(discordUserId, {
    googleSub: 'sub-store',
    email: 'store@example.com',
    accessToken: 'enc-a',
    refreshToken: 'enc-r',
    scopes: [GMAIL_READONLY_SCOPE]
  });
  const accounts = store.listGmailAccounts(discordUserId);
  const accountId = accounts[0].id;

  const initial = store.getProcessedExternalIds(accountId);
  assert.equal(initial.size, 0);

  store.recordProcessedItems(accountId, ['msg1', 'msg2']);
  const afterFirst = store.getProcessedExternalIds(accountId);
  assert.equal(afterFirst.size, 2);
  assert.ok(afterFirst.has('msg1'));
  assert.ok(afterFirst.has('msg2'));

  // Idempotent recording of duplicates
  store.recordProcessedItems(accountId, ['msg2', 'msg3']);
  const afterSecond = store.getProcessedExternalIds(accountId);
  assert.equal(afterSecond.size, 3);
  assert.ok(afterSecond.has('msg3'));
});

const mysqlUrl = process.env.MYSQL_TEST_URL;
test('MySQL store records and retrieves processed external IDs', { skip: !mysqlUrl }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const discordUserId = `mysql-dedup-${suffix}`;
  const store = await makeMysqlStore(mysqlUrl);
  try {
    await store.getOrCreateUser(discordUserId);
    await store.saveGmailAccount(discordUserId, {
      googleSub: `sub-${suffix}`,
      email: `${suffix}@example.com`,
      accessToken: 'enc-a',
      refreshToken: 'enc-r',
      scopes: [GMAIL_READONLY_SCOPE]
    });
    const accounts = await store.listGmailAccounts(discordUserId);
    const accountId = accounts[0].id;

    const initial = await store.getProcessedExternalIds(accountId);
    assert.equal(initial.size, 0);

    await store.recordProcessedItems(accountId, ['msg1', 'msg2']);
    const afterFirst = await store.getProcessedExternalIds(accountId);
    assert.equal(afterFirst.size, 2);
    assert.ok(afterFirst.has('msg1'));

    // Duplicate record check
    await store.recordProcessedItems(accountId, ['msg2', 'msg3']);
    const afterSecond = await store.getProcessedExternalIds(accountId);
    assert.equal(afterSecond.size, 3);
  } finally {
    await store.deleteAllUserData(discordUserId);
    await store.close();
  }
});

test('duplicate emails are filtered out and only new emails are sent to AI provider', async () => {
  const db = openDatabase();
  const store = makeStore(db);
  const discordUserId = setupUserWithKey(store, 'filtering-user');

  let summarizedMessages = [];
  const summarizerFactory = () => ({
    summarize: async (messages) => {
      summarizedMessages = messages;
      return 'Summary of new emails';
    }
  });

  let fetchedMessages = [{ id: 'msg1', snippet: 'first email' }, { id: 'msg2', snippet: 'second email' }];
  const gmailAdapterFactory = () => ({
    listRecentMessages: async () => fetchedMessages
  });

  // Run 1: process msg1 and msg2
  const run1 = await runSummaryForUser({
    discordUserId,
    store,
    env,
    gmailAdapterFactory,
    summarizerFactory,
    autoRecord: true
  });

  assert.equal(run1.newEmailCount, 2);
  assert.equal(run1.summary, 'Summary of new emails');
  assert.equal(summarizedMessages.length, 2);

  // Run 2: inbox now contains msg1, msg2, and new msg3
  fetchedMessages = [
    { id: 'msg1', snippet: 'first email' },
    { id: 'msg2', snippet: 'second email' },
    { id: 'msg3', snippet: 'third email (new)' }
  ];

  const run2 = await runSummaryForUser({
    discordUserId,
    store,
    env,
    gmailAdapterFactory,
    summarizerFactory,
    autoRecord: true
  });

  assert.equal(run2.newEmailCount, 1);
  assert.equal(summarizedMessages.length, 1);
  assert.equal(summarizedMessages[0].id, 'msg3');
});

test('an all-duplicate inbox results in "no new emails" DM with AI provider never called', async () => {
  const db = openDatabase();
  const store = makeStore(db);
  const discordUserId = setupUserWithKey(store, 'all-dup-user');

  let aiCalls = 0;
  const summarizerFactory = () => ({
    summarize: async () => {
      aiCalls += 1;
      return 'AI Summary';
    }
  });

  const gmailAdapterFactory = () => ({
    listRecentMessages: async () => [{ id: 'msg1' }, { id: 'msg2' }]
  });

  // Run 1: process all emails
  const run1 = await runSummaryForUser({
    discordUserId,
    store,
    env,
    gmailAdapterFactory,
    summarizerFactory,
    autoRecord: true
  });
  assert.equal(run1.newEmailCount, 2);
  assert.equal(aiCalls, 1);

  // Run 2: fetch same emails again
  const run2 = await runSummaryForUser({
    discordUserId,
    store,
    env,
    gmailAdapterFactory,
    summarizerFactory,
    autoRecord: true
  });

  assert.equal(run2.newEmailCount, 0);
  assert.equal(run2.summary, 'You have no new unread emails since your last summary.');
  assert.equal(aiCalls, 1); // AI provider was NOT called on second run
});

test('failed AI call does NOT record processed IDs', async () => {
  const db = openDatabase();
  const store = makeStore(db);
  const discordUserId = setupUserWithKey(store, 'ai-fail-user');

  let shouldFail = true;
  const summarizerFactory = () => ({
    summarize: async () => {
      if (shouldFail) throw new Error('AI provider error');
      return 'Recovered summary';
    }
  });

  const gmailAdapterFactory = () => ({
    listRecentMessages: async () => [{ id: 'msg1' }]
  });

  // Run 1: AI fails
  await assert.rejects(
    async () => {
      await runSummaryForUser({
        discordUserId,
        store,
        env,
        gmailAdapterFactory,
        summarizerFactory,
        autoRecord: true
      });
    },
    (err) => err instanceof PipelineError && err.code === 'AI_FAILURE'
  );

  const accounts = store.listGmailAccounts(discordUserId);
  const processed = store.getProcessedExternalIds(accounts[0].id);
  assert.equal(processed.size, 0);

  // Run 2: AI succeeds - email is still processed now
  shouldFail = false;
  const run2 = await runSummaryForUser({
    discordUserId,
    store,
    env,
    gmailAdapterFactory,
    summarizerFactory,
    autoRecord: true
  });
  assert.equal(run2.newEmailCount, 1);
  assert.equal(run2.summary, 'Recovered summary');

  const processedAfter = store.getProcessedExternalIds(accounts[0].id);
  assert.equal(processedAfter.size, 1);
  assert.ok(processedAfter.has('msg1'));
});

test('failed DM delivery in scheduler does NOT record processed IDs', async () => {
  const db = openDatabase();
  const store = makeStore(db);
  const discordUserId = setupUserWithKey(store, 'delivery-fail-user');
  store.updateSettings(discordUserId, { summaryTime: '09:00', timezone: 'UTC' });

  const gmailAdapterFactory = () => ({
    listRecentMessages: async () => [{ id: 'msg1' }]
  });

  const summarizerFactory = () => ({
    summarize: async () => 'Scheduled Summary'
  });

  let deliverShouldFail = true;
  let deliveredContent = null;

  const scheduler = new SummaryScheduler({
    store,
    env,
    now: () => new Date('2026-08-28T09:05:00.000Z'),
    pipeline: (opts) => runSummaryForUser({ ...opts, gmailAdapterFactory, summarizerFactory }),
    deliver: async ({ content }) => {
      if (deliverShouldFail) {
        throw Object.assign(new Error('Discord connection timeout'), { code: 'DISCORD_DM_FAILURE' });
      }
      deliveredContent = content;
    },
    onFailure: () => {}
  });

  // Tick 1: delivery fails
  const tick1 = await scheduler.tick();
  assert.equal(tick1.failed, 1);

  const accounts = store.listGmailAccounts(discordUserId);
  const processed1 = store.getProcessedExternalIds(accounts[0].id);
  assert.equal(processed1.size, 0); // Not recorded because delivery failed!

  // Reset summary history for re-test or next tick
  db.prepare('DELETE FROM summary_history WHERE user_id=?').run(store.getUser(discordUserId).id);

  // Tick 2: delivery succeeds
  deliverShouldFail = false;
  const tick2 = await scheduler.tick();
  assert.equal(tick2.completed, 1);
  assert.equal(deliveredContent, 'Scheduled Summary');

  const processed2 = store.getProcessedExternalIds(accounts[0].id);
  assert.equal(processed2.size, 1);
  assert.ok(processed2.has('msg1'));
});

test('/summary-now records processed IDs post-delivery and isolates failures', async () => {
  const db = openDatabase();
  const store = makeStore(db);
  const discordUserId = setupUserWithKey(store, 'cmd-summary-user');

  let shouldFail = true;
  const summarizerFactory = () => ({
    summarize: async () => {
      if (shouldFail) throw new Error('AI rate limited');
      return 'Manual Summary';
    }
  });

  const gmailAdapterFactory = () => ({
    listRecentMessages: async () => [{ id: 'msg_cmd_1' }]
  });

  const interaction = {
    type: 2,
    user: { id: discordUserId },
    data: { name: 'summary-now' }
  };

  // Run 1: /summary-now with AI failure -> error reply returned, IDs NOT recorded
  const reply1 = await handleInteraction(interaction, {
    store,
    env,
    gmailAdapterFactory,
    summarizerFactory
  });

  assert.equal(reply1.data.content, 'Your AI provider needs attention. Check `/models` and `/set-ai-key`.');
  const accounts = store.listGmailAccounts(discordUserId);
  const processed1 = store.getProcessedExternalIds(accounts[0].id);
  assert.equal(processed1.size, 0);

  // Run 2: /summary-now succeeds -> reply returned, IDs recorded
  shouldFail = false;
  const reply2 = await handleInteraction(interaction, {
    store,
    env,
    gmailAdapterFactory,
    summarizerFactory
  });

  assert.equal(reply2.data.content, 'Manual Summary');
  const processed2 = store.getProcessedExternalIds(accounts[0].id);
  assert.equal(processed2.size, 1);
  assert.ok(processed2.has('msg_cmd_1'));
});
