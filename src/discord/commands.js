import { encryptSecret, decryptSecret } from '../security/index.js';
import { fetchProviderModels, providerDefinition, resolveProvider, credentialDisplayName } from '../summarizer/providers.js';
import { runSummaryForUser, PipelineError } from '../summarizer/pipeline.js';

export const COMMANDS = [
  { name: 'sample', description: 'See a sample email summary' },
  { name: 'connect', description: 'Connect a Gmail account' },
  { name: 'accounts', description: 'List connected Gmail accounts' },
  { name: 'disconnect', description: 'Disconnect and purge a Gmail account', options: [{ name: 'email', description: 'Email address of the account to disconnect', type: 3, required: false }] },
  { name: 'settings', description: 'Show your MailDM settings' },
  { name: 'set-time', description: 'Set daily summary time', options: [{ name: 'time', description: 'Time in 24-hour HH:MM format, e.g. 09:00', type: 3, required: true }, { name: 'timezone', description: 'IANA timezone, e.g. America/New_York', type: 3, required: false }] },
  { name: 'set-ai-provider', description: 'Set the legacy default AI provider', options: [{ name: 'provider', description: 'AI provider to use', type: 3, required: true, choices: [{ name: 'OpenAI', value: 'openai' }, { name: 'Anthropic', value: 'anthropic' }] }] },
  { name: 'set-model', description: 'Set a model selection token from /models', options: [{ name: 'selection', description: 'Model selection token from /models', type: 3, required: true }] },
  { name: 'set-ai-key', description: 'Add a provider API key privately', options: [{ name: 'provider', description: 'AI provider this key belongs to', type: 3, required: true, choices: [{ name: 'OpenAI', value: 'openai' }, { name: 'Anthropic', value: 'anthropic' }, { name: 'OpenRouter', value: 'openrouter' }, { name: 'Custom', value: 'custom' }] }, { name: 'key', description: 'Your API key', type: 3, required: true }, { name: 'base_url', description: 'Custom API base URL (for Custom provider)', type: 3, required: false }, { name: 'label', description: 'Friendly label for this credential', type: 3, required: false }] },
  { name: 'models', description: 'Browse and select your available AI models' },
  { name: 'remove-api-key', description: 'Remove a stored AI credential', options: [{ name: 'credential', description: 'Credential selection token from /models', type: 3, required: true }] },
  { name: 'summary-now', description: 'Summarize recent Gmail' },
  { name: 'delete-my-data', description: 'Delete all MailDM data for this Discord user' },
  { name: 'reauthorize', description: 'Reconnect Gmail authorization' }
];

function option(interaction, name) { return interaction.data?.options?.find((item) => item.name === name)?.value; }
function reply(content, extra = {}) { return { type: 4, data: { content, flags: 64, ...extra } }; }
function isDm(interaction) { return !interaction.guild_id; }
export const feedbackComponents = [{ type: 1, components: [{ type: 2, style: 2, label: 'Helpful', custom_id: 'feedback:helpful' }, { type: 2, style: 2, label: 'Not helpful', custom_id: 'feedback:not_helpful' }] }];
const modelButton = (token, modelId) => ({ type: 2, style: 1, label: modelId.length > 80 ? `${modelId.slice(0, 77)}...` : modelId, custom_id: `ai-model:${token}` });

async function modelListing(discordUserId, deps) {
  const credentials = await deps.store.listAiCredentials(discordUserId);
  const components = [];
  const sections = [];
  // /models is intentionally cache-first. Provider refreshes are out of this request path.
  for (const credential of credentials) {
    const models = credential.cachedModels ?? [];
    const label = credential.label ? `${credentialDisplayName(credential)} (${credential.label})` : credentialDisplayName(credential);
    sections.push(`${label}${credential.active ? ' [active]' : ''} — ${models.length} cached model${models.length === 1 ? '' : 's'}`);
    const buttons = [];
    for (const model of models.slice(0, 20)) {
      const token = await deps.store.createModelChoice(discordUserId, credential.id, model.id);
      buttons.push(modelButton(token, model.id));
    }
    const removeToken = await deps.store.createCredentialChoice(discordUserId, credential.id);
    buttons.push({ type: 2, style: 4, label: `Remove ${credentialDisplayName(credential)}`.slice(0, 80), custom_id: `ai-remove:${removeToken}` });
    for (let index = 0; index < buttons.length; index += 5) components.push({ type: 1, components: buttons.slice(index, index + 5) });
  }
  return { sections, components };
}

export async function handleInteraction(interaction, deps) {
  const discordUserId = interaction.member?.user?.id ?? interaction.user?.id;
  const name = interaction.data?.name;
  if (!discordUserId) return reply('Invalid interaction.');
  await deps.store.getOrCreateUser(discordUserId);
  if (interaction.type === 3 && String(interaction.data?.custom_id ?? '').startsWith('ai-remove:')) {
    if (!isDm(interaction)) return reply('AI credential and model controls are available only in a direct message.');
    const choice = await deps.store.consumeCredentialChoice(discordUserId, String(interaction.data.custom_id).slice('ai-remove:'.length));
    if (!choice) return reply('That credential selection expired. Run `/models` again.');
    const result = await deps.store.removeAiCredential(discordUserId, choice.credentialId);
    if (!result.removed) return reply('That credential is no longer available. Run `/models` again.');
    return reply(result.wasActive ? 'Credential removed. Your active model was cleared; run `/models` to choose a new model.' : 'Credential removed. Gmail, settings, schedule, history, and feedback were not changed.');
  }
  if (interaction.type === 3 && String(interaction.data?.custom_id ?? '').startsWith('ai-model:')) {
    if (!isDm(interaction)) return reply('AI credential and model controls are available only in a direct message.');
    const choice = await deps.store.consumeModelChoice(discordUserId, String(interaction.data.custom_id).slice('ai-model:'.length));
    if (!choice) return reply('That model selection expired. Run `/models` again.');
    const credentials = await deps.store.listAiCredentials(discordUserId);
    const credential = credentials.find((item) => Number(item.id) === Number(choice.credentialId));
    if (!credential || !(credential.cachedModels ?? []).some((model) => model.id === choice.modelId)) return reply('That model is no longer available. Run `/models` again.');
    await deps.store.setActiveAiCredential(discordUserId, choice.credentialId, choice.modelId);
    return reply(`Active model set to ${credentialDisplayName(credential)} / ${choice.modelId}.`);
  }
  if (!name) return reply('Invalid interaction.');

  if (name === 'sample') return reply('**Sample summary**\nKey points: Your weekly planning meeting is Thursday at 10:00.\nAction items: Review the attached agenda before Wednesday.\nRisks: None detected.');
  if (name === 'connect' || name === 'reauthorize') return reply(`Authorize Gmail here: ${deps.env.APP_BASE_URL}/auth/google/start?discord_user_id=${encodeURIComponent(discordUserId)}`);
  if (name === 'accounts') {
    const accounts = await deps.store.listGmailAccounts(discordUserId);
    return reply(accounts.length ? accounts.map((account) => `• ${account.email}`).join('\n') : 'No Gmail accounts connected. Use `/connect`.');
  }
  if (name === 'disconnect') { await deps.store.disconnectAndPurge(discordUserId, option(interaction, 'email')); return reply('Disconnected the requested Gmail account and purged only its stored Gmail data. Your settings, history, and feedback are unchanged.'); }
  if (name === 'delete-my-data') { await deps.store.deleteAllUserData(discordUserId); return reply('Deleted all MailDM data for this Discord user, including Gmail tokens, AI credentials, settings, feedback, and summary history.'); }
  if (name === 'settings') {
    const settings = await deps.store.getSettings(discordUserId);
    const credentials = deps.store.listAiCredentials ? await deps.store.listAiCredentials(discordUserId) : [];
    const active = credentials.find((item) => item.active);
    return reply(`Provider: ${active?.provider ?? settings.aiProvider ?? 'none'}\nModel: ${active?.activeModel ?? settings.aiModel ?? 'none'}\nSummary time: ${settings.summaryTime} (${settings.timezone})\nStored AI credentials: ${credentials.length}`);
  }
  if (name === 'set-time') { const time = option(interaction, 'time'); const timezone = option(interaction, 'timezone') ?? (await deps.store.getSettings(discordUserId)).timezone; if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return reply('Use 24-hour HH:MM format, for example `09:00`.'); try { Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); } catch { return reply('Use a valid IANA timezone, for example `America/New_York`.'); } await deps.store.updateSettings(discordUserId, { summaryTime: time, timezone }); return reply(`Daily summary time set to ${time} (${timezone}).`); }
  if (name === 'set-ai-provider') { const provider = option(interaction, 'provider'); if (!['openai', 'anthropic'].includes(provider)) return reply('Provider must be `openai` or `anthropic`.'); await deps.store.updateSettings(discordUserId, { aiProvider: provider }); return reply(`Legacy provider preference set to ${provider}. Add/select a credential with /set-ai-key and /models.`); }
  if (['set-ai-key', 'models', 'set-model', 'remove-api-key'].includes(name) && !isDm(interaction)) return reply('AI credential and model controls are available only in a direct message.');
  if (name === 'set-ai-key') {
    const provider = option(interaction, 'provider') ?? 'openai'; const key = option(interaction, 'key'); const label = option(interaction, 'label'); const suppliedBaseUrl = option(interaction, 'base_url');
    if (!key || key.length < 10 || key.length > 500) return reply('Invalid API key.');
    if (provider === 'custom' && (!label || label.length > 120)) return reply('Custom credentials require a user-friendly label of 1–120 characters.');
    let resolved; try { resolved = resolveProvider(provider, suppliedBaseUrl); } catch (error) { return reply(error.message); }
    try {
      const discovered = await fetchProviderModels({ provider, baseUrl: resolved.baseUrl, apiKey: key, fetchImpl: deps.fetchImpl });
      await deps.store.saveAiCredential(discordUserId, { provider, label: provider === 'custom' ? label : null, baseUrl: resolved.baseUrl, encryptedApiKey: encryptSecret(key, deps.env.SESSION_SECRET), cachedModels: discovered.models });
      return reply(`${resolved.name} credential saved securely. ${discovered.models.length} models cached. Run \`/models\` to choose the active model.`);
    } catch (error) { return reply(error.code === 'AI_AUTH_FAILURE' ? 'That API key was rejected. Nothing was saved.' : 'The provider could not be validated or its model list could not be fetched. Nothing was saved.'); }
  }
  if (name === 'models') { const listing = await modelListing(discordUserId, deps); return reply(listing.sections.length ? listing.sections.join('\n') : 'No AI credentials stored. Use `/set-ai-key` in this DM.', listing.components.length ? { components: listing.components } : {}); }
  if (name === 'set-model') { const choice = await deps.store.consumeModelChoice(discordUserId, String(option(interaction, 'selection'))); if (!choice) return reply('That model selection expired. Run `/models` again.'); if (!await deps.store.setActiveAiCredential(discordUserId, choice.credentialId, choice.modelId)) return reply('That credential is no longer available. Run `/models` again.'); return reply(`Active model set to ${choice.modelId}.`); }
  if (name === 'remove-api-key') { const selected = String(option(interaction, 'credential')); const choice = await deps.store.consumeCredentialChoice(discordUserId, selected); if (!choice) return reply('That credential selection expired. Run `/models` again.'); const result = await deps.store.removeAiCredential(discordUserId, choice.credentialId); if (!result.removed) return reply('Credential not found. Run `/models` to refresh the list.'); return reply(result.wasActive ? 'Credential removed. Your active model was cleared; run `/models` to choose a new model.' : 'Credential removed. Gmail, settings, schedule, history, and feedback were not changed.'); }
  if (name === 'summary-now') {
    const accounts = await deps.store.listGmailAccounts(discordUserId); if (!accounts.length) return reply('No Gmail account connected. Use `/connect` first.');
    try {
      const result = await runSummaryForUser({ discordUserId, store: deps.store, env: deps.env, fetchImpl: deps.fetchImpl, gmailAdapterFactory: deps.gmailAdapterFactory, summarizerFactory: deps.summarizerFactory, autoRecord: false });
      const response = reply(result.summary, { components: feedbackComponents });
      if (typeof result?.recordProcessedItems === 'function') {
        await result.recordProcessedItems();
      }
      return response;
    }
    catch (error) { if (error instanceof PipelineError) return reply(error.code === 'REAUTH_REQUIRED' ? 'Gmail authorization needs attention. Use `/reauthorize`.' : error.code === 'NO_AI_PROVIDER' ? error.message : ['AI_FAILURE', 'AI_AUTH_FAILURE'].includes(error.code) ? 'Your AI provider needs attention. Check `/models` and `/set-ai-key`.' : error.message); throw error; }
  }
  return reply('Unknown command.');
}
