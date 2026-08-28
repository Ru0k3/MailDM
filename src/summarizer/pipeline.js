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

export async function runSummaryForUser({ discordUserId, store, env = process.env, fetchImpl = fetch, gmailAdapterFactory = makeGmailAdapter, summarizerFactory = makeSummarizer }) {
  const accounts = await store.listGmailAccounts(discordUserId);
  if (!accounts.length) throw new PipelineError('NO_ACCOUNT', 'No Gmail account is connected.');
  const emails = [];
  const authFailures = [];
  for (const account of accounts) {
    if (account.reauthRequired) { authFailures.push(account); continue; }
    try {
      const fetched = await gmailAdapterFactory({ account, env }).listRecentMessages({ maxResults: 10 });
      emails.push(...fetched);
    } catch (error) {
      if (isAuthFailure(error)) {
        await store.markAccountReauthRequired(discordUserId, account.email);
        authFailures.push(account);
      } else throw new PipelineError('GMAIL_FAILURE', `Could not read Gmail account ${account.email}.`, error);
    }
  }
  if (authFailures.length && !emails.length) throw new PipelineError('REAUTH_REQUIRED', 'Gmail authorization needs to be renewed.');
  const settings = await store.getSettings(discordUserId);
  const effectiveSettings = { ...settings, aiApiKey: decryptSecret(settings.aiApiKey, env.SESSION_SECRET) };
  let summary;
  try {
    summary = await summarizerFactory(effectiveSettings, env, fetchImpl).summarize(emails);
  } catch (error) {
    const code = error?.code === 'AI_AUTH_FAILURE' ? 'AI_AUTH_FAILURE' : 'AI_FAILURE';
    throw new PipelineError(code, code === 'AI_AUTH_FAILURE' ? 'The configured AI key was rejected.' : 'The configured AI provider rejected or rate-limited the request.', error);
  }
  return { summary: summary || 'No summary was returned.', authFailures };
}
