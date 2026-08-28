import { encryptSecret, decryptSecret } from '../security/index.js';
import { runSummaryForUser, PipelineError } from '../summarizer/pipeline.js';

export const COMMANDS = [
  { name: 'sample', description: 'See a sample email summary' },
  { name: 'connect', description: 'Connect a Gmail account' },
  { name: 'accounts', description: 'List connected Gmail accounts' },
  { name: 'disconnect', description: 'Disconnect and purge a Gmail account', options: [{ name: 'email', type: 3, required: false }] },
  { name: 'settings', description: 'Show your MailDM settings' },
  { name: 'set-time', description: 'Set daily summary time', options: [{ name: 'time', type: 3, required: true }, { name: 'timezone', type: 3, required: false }] },
  { name: 'set-ai-provider', description: 'Set the AI provider', options: [{ name: 'provider', type: 3, required: true, choices: [{ name: 'OpenAI', value: 'openai' }, { name: 'Anthropic', value: 'anthropic' }] }] },
  { name: 'set-model', description: 'Set the AI model', options: [{ name: 'model', type: 3, required: true }] },
  { name: 'set-ai-key', description: 'Set your personal AI API key', options: [{ name: 'key', type: 3, required: true }] },
  { name: 'summary-now', description: 'Summarize recent Gmail' },
  { name: 'delete-my-data', description: 'Delete all MailDM data for this Discord user' },
  { name: 'reauthorize', description: 'Reconnect Gmail authorization' }
];

function option(interaction, name) { return interaction.data?.options?.find((item) => item.name === name)?.value; }
function reply(content, extra = {}) { return { type: 4, data: { content, flags: 64, ...extra } }; }
export const feedbackComponents = [{ type: 1, components: [{ type: 2, style: 2, label: 'Helpful', custom_id: 'feedback:helpful' }, { type: 2, style: 2, label: 'Not helpful', custom_id: 'feedback:not_helpful' }] }];

export async function handleInteraction(interaction, deps) {
  const discordUserId = interaction.member?.user?.id ?? interaction.user?.id;
  const name = interaction.data?.name;
  if (!discordUserId || !name) return reply('Invalid interaction.');
  deps.store.getOrCreateUser(discordUserId);

  if (name === 'sample') return reply('**Sample summary**\nKey points: Your weekly planning meeting is Thursday at 10:00.\nAction items: Review the attached agenda before Wednesday.\nRisks: None detected.');
  if (name === 'connect' || name === 'reauthorize') return reply(`Authorize Gmail here: ${deps.env.APP_BASE_URL}/auth/google/start?discord_user_id=${encodeURIComponent(discordUserId)}`);
  if (name === 'accounts') {
    const accounts = deps.store.listGmailAccounts(discordUserId);
    return reply(accounts.length ? accounts.map((account) => `• ${account.email}`).join('\n') : 'No Gmail accounts connected. Use `/connect`.');
  }
  if (name === 'disconnect') {
    deps.store.disconnectAndPurge(discordUserId, option(interaction, 'email'));
    return reply('Disconnected the requested Gmail account and purged its stored tokens and account data.');
  }
  if (name === 'delete-my-data') {
    deps.store.deleteAllUserData(discordUserId);
    return reply('Deleted all MailDM data for this Discord user, including Gmail tokens, settings, and feedback.');
  }
  if (name === 'settings') {
    const settings = deps.store.getSettings(discordUserId);
    return reply(`Provider: ${settings.aiProvider}\nModel: ${settings.aiModel}\nSummary time: ${settings.summaryTime} (${settings.timezone})\nAI key: ${settings.aiApiKey ? 'configured' : 'not configured'}`);
  }
  if (name === 'set-time') {
    const time = option(interaction, 'time');
    const timezone = option(interaction, 'timezone') ?? deps.store.getSettings(discordUserId).timezone;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return reply('Use 24-hour HH:MM format, for example `09:00`.');
    try { Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); } catch { return reply('Use a valid IANA timezone, for example `America/New_York`.'); }
    deps.store.updateSettings(discordUserId, { summaryTime: time, timezone });
    return reply(`Daily summary time set to ${time} (${timezone}).`);
  }
  if (name === 'set-ai-provider') {
    const provider = option(interaction, 'provider');
    if (!['openai', 'anthropic'].includes(provider)) return reply('Provider must be `openai` or `anthropic`.');
    deps.store.updateSettings(discordUserId, { aiProvider: provider });
    return reply(`AI provider set to ${provider}.`);
  }
  if (name === 'set-model') {
    const model = option(interaction, 'model');
    if (!model || model.length > 120) return reply('Invalid model.');
    deps.store.updateSettings(discordUserId, { aiModel: model });
    return reply(`AI model set to ${model}.`);
  }
  if (name === 'set-ai-key') {
    const key = option(interaction, 'key');
    if (!key || key.length < 10 || key.length > 500) return reply('Invalid API key.');
    deps.store.updateSettings(discordUserId, { aiApiKey: encryptSecret(key, deps.env.SESSION_SECRET) });
    return reply('AI API key saved encrypted at rest. It will not be displayed back to you.');
  }
  if (name === 'summary-now') {
    const accounts = deps.store.listGmailAccounts(discordUserId);
    if (!accounts.length) return reply('No Gmail account connected. Use `/connect` first.');
    try {
      const result = await runSummaryForUser({ discordUserId, store: deps.store, env: deps.env, fetchImpl: deps.fetchImpl, gmailAdapterFactory: deps.gmailAdapterFactory, summarizerFactory: deps.summarizerFactory });
      return reply(result.summary, { components: feedbackComponents });
    } catch (error) {
      if (error instanceof PipelineError) return reply(error.code === 'REAUTH_REQUIRED' ? 'Gmail authorization needs attention. Use `/reauthorize`.' : ['AI_FAILURE', 'AI_AUTH_FAILURE'].includes(error.code) ? 'Your AI key or provider needs attention. Check `/settings` and try again.' : error.message);
      throw error;
    }
  }
  return reply('Unknown command.');
}
