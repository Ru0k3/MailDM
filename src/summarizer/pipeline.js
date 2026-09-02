import { decryptSecret } from '../security/index.js';
import { makeGmailAdapter } from '../gmail/service.js';
import { makeSummarizer } from './index.js';

export class PipelineError extends Error {
  constructor(code, message, cause = undefined) { super(message, { cause }); this.name = 'PipelineError'; this.code = code; }
}

function isAuthFailure(error) {
  const text = `${error?.code ?? ''} ${error?.response?.status ?? ''} ${error?.message ?? ''}`.toLowerCase();
  return text.includes('401') || text.includes('unauthorized') || text.includes('invalid_grant') || text.includes('refresh token');
}

export async function runSummaryForUser({ discordUserId, store, env = process.env, fetchImpl = fetch, gmailAdapterFactory = makeGmailAdapter, summarizerFactory = makeSummarizer, autoRecord = false }) {
  const accounts = await store.listGmailAccounts(discordUserId);
  if (!accounts.length) throw new PipelineError('NO_ACCOUNT', 'No Gmail account is connected.');
  const emails = [];
  const authFailures = [];
  const accountItemsToRecord = [];

  for (const account of accounts) {
    if (account.reauthRequired) { authFailures.push(account); continue; }
    try {
      const fetched = await gmailAdapterFactory({ account, env }).listRecentMessages({ maxResults: 10 });
      const processedSet = store.getProcessedExternalIds ? await store.getProcessedExternalIds(account.id) : new Set();
      const newMessages = fetched.filter((msg) => msg.id && !processedSet.has(msg.id));
      emails.push(...newMessages);
      if (newMessages.length) {
        accountItemsToRecord.push({ accountId: account.id, externalIds: newMessages.map((msg) => msg.id) });
      }
    } catch (error) {
      if (isAuthFailure(error)) {
        await store.markAccountReauthRequired(discordUserId, account.email);
        authFailures.push(account);
      } else throw new PipelineError('GMAIL_FAILURE', `Could not read Gmail account ${account.email}.`, error);
    }
  }

  const recordProcessedItems = async () => {
    if (store.recordProcessedItems) {
      for (const item of accountItemsToRecord) {
        await store.recordProcessedItems(item.accountId, item.externalIds);
      }
    }
  };

  if (authFailures.length && !emails.length) throw new PipelineError('REAUTH_REQUIRED', 'Gmail authorization needs to be renewed.');
  if (!emails.length) {
    if (autoRecord) await recordProcessedItems();
    return { summary: 'You have no new unread emails since your last summary.', authFailures, newEmailCount: 0, recordProcessedItems };
  }

  const settings = await store.getSettings(discordUserId);
  const activeCredential = store.getActiveAiCredential ? await store.getActiveAiCredential(discordUserId) : null;
  const effectiveSettings = activeCredential
    ? { ...settings, aiProvider: activeCredential.provider, aiModel: activeCredential.activeModel, baseUrl: activeCredential.baseUrl, aiApiKey: decryptSecret(activeCredential.encryptedApiKey, env.SESSION_SECRET) }
    : { ...settings, aiApiKey: decryptSecret(settings.aiApiKey, env.SESSION_SECRET) };
  if (!effectiveSettings.aiApiKey) throw new PipelineError('NO_AI_PROVIDER', 'No AI provider is configured. Add a key with `/set-ai-key`, then choose a model with `/models`.');
  let summary;
  try {
    summary = await summarizerFactory(effectiveSettings, env, fetchImpl).summarize(emails);
  } catch (error) {
    const code = error?.code === 'AI_AUTH_FAILURE' ? 'AI_AUTH_FAILURE' : 'AI_FAILURE';
    throw new PipelineError(code, code === 'AI_AUTH_FAILURE' ? 'The configured AI key was rejected.' : 'The configured AI provider rejected or rate-limited the request.', error);
  }

  if (autoRecord) await recordProcessedItems();
  return { summary: summary || 'No summary was returned.', authFailures, newEmailCount: emails.length, recordProcessedItems };
}