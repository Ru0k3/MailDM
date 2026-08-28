import type { Express, Request, Response } from "express";
import express from "express";
import { createHeartbeatJob, deleteHeartbeatJob, updateHeartbeatJob } from "./_core/heartbeat";
import { getAiAdapter, providerChoices } from "./aiProviders";
import { commandOption, componentAcknowledgement, deferredInteractionResponse, interactionResponse, interactionUser, isDirectMessageInteraction, sendDiscordInteractionFollowup, type DiscordInteraction, verifyDiscordRequest } from "./discord";
import { createGmailAuthorizationUrl, revokeGoogleRefreshToken } from "./gmailOAuth";
import { credentialFingerprint, encryptCredential } from "./maildmCrypto";
import { getRecommendedModels, isRecommendedModel } from "./maildmConfig";
import {
  attachScheduleTask,
  createOAuthState,
  deleteDiscordUserData,
  disconnectAccount,
  getGmailAccount,
  getScheduleByDiscordUserId,
  listConnectedAccounts,
  recordAuditEvent,
  recordSummaryFeedback,
  setAiSelection,
  upsertAiCredential,
  upsertDiscordUser,
  upsertSchedulePreference,
} from "./maildmDb";
import { nextLocalOccurrence, oneTimeUtcCron } from "./scheduledRoutes";
import { deliveryDateString, runDigestForSchedule } from "./maildmWorkflow";

type ConfigurableProvider = "openai" | "anthropic" | "nvidia";

function isConfigurableProvider(value: string): value is ConfigurableProvider {
  return value === "openai" || value === "anthropic" || value === "nvidia";
}

function dmOnly(res: Response) {
  return interactionResponse(res, "For your privacy, please open a direct message with MailDM and run this command there.", { ephemeral: true });
}

function sanitizeLabel(value: string | undefined) {
  const clean = (value ?? "Gmail").replace(/[^a-zA-Z0-9\s._-]/g, "").trim();
  return (clean || "Gmail").slice(0, 120);
}

function modalResponse(res: Response, customId: string, title: string, label: string) {
  return res.status(200).json({
    type: 9,
    data: {
      custom_id: customId,
      title,
      components: [{ type: 1, components: [{ type: 4, custom_id: "api_key", label, style: 1, min_length: 10, max_length: 3000, required: true }] }],
    },
  });
}

function modalValue(interaction: DiscordInteraction) {
  const data = interaction.data as unknown as { components?: Array<{ components?: Array<{ custom_id?: string; value?: string }> }> } | undefined;
  return data?.components?.flatMap(row => row.components ?? []).find(component => component.custom_id === "api_key")?.value?.trim();
}

function scheduleInput(time: string | undefined, timezone: string | undefined) {
  if (!time || !timezone || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) throw new Error("invalid_schedule");
  Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  return { time, timezone };
}

const sampleBrief = [
  "**Your sample MailDM brief**",
  "This illustrative example is available before MailDM connects to Gmail. It does not use your data.",
  "",
  "**1. [Work] Project decision requested**",
  "A teammate is waiting for your approval before the next milestone. _Needs a reply today._",
  "",
  "**2. [Personal] Upcoming appointment**",
  "A reminder includes a date and preparation details. _Worth adding to your calendar._",
].join("\n");

async function configureDailySchedule(discordUserId: number, time: string, timezone: string) {
  const prior = await getScheduleByDiscordUserId(discordUserId);
  const schedule = await upsertSchedulePreference(discordUserId, time, timezone);
  if (!schedule) throw new Error("schedule_creation_failed");
  const next = nextLocalOccurrence(timezone, time);
  const schedulePatch = { cron: oneTimeUtcCron(next), path: "/api/scheduled/digest", description: `MailDM daily digest for schedule ${schedule.id}` };
  if (prior?.scheduleCronTaskUid) await updateHeartbeatJob(prior.scheduleCronTaskUid, schedulePatch, "");
  else {
    const job = await createHeartbeatJob({ name: `maildm-digest-${discordUserId}`, ...schedulePatch }, "");
    await attachScheduleTask(schedule.id, job.taskUid);
  }
  return schedule;
}

export function registerDiscordInteractionRoutes(app: Express) {
  app.post("/api/discord/interactions", express.raw({ type: "application/json", limit: "1mb" }), async (req: Request, res: Response) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!verifyDiscordRequest(req, rawBody)) return res.status(401).json({ error: "invalid interaction signature" });
    let interaction: DiscordInteraction;
    try {
      interaction = JSON.parse(rawBody.toString("utf8")) as DiscordInteraction;
    } catch {
      return res.status(400).json({ error: "invalid interaction payload" });
    }
    if (interaction.type === 1) return res.status(200).json({ type: 1 });

    try {
      const user = interactionUser(interaction);
      const discordUser = await upsertDiscordUser(user.id, user.displayName);
      if (!discordUser) throw new Error("discord_user_creation_failed");

      if (interaction.type === 5) {
        if (!isDirectMessageInteraction(interaction)) return dmOnly(res);
        const customId = (interaction.data as unknown as { custom_id?: string } | undefined)?.custom_id ?? "";
        const provider = customId.replace("maildm:api-key:", "");
        const apiKey = modalValue(interaction);
        if (!isConfigurableProvider(provider) || !apiKey) return interactionResponse(res, "That secure key form has expired. Run /set-ai-key again.", { ephemeral: true });
        const validation = await getAiAdapter(provider).validateCredential(apiKey);
        if (!validation.valid) return interactionResponse(res, "The provider could not validate that key. It was not saved. Check the key and try again.", { ephemeral: true });
        await upsertAiCredential({ discordUserId: discordUser.id, provider, encryptedApiKey: encryptCredential(apiKey), keyFingerprint: credentialFingerprint(apiKey) });
        await recordAuditEvent({ discordUserId: discordUser.id, eventType: "ai_key_validated", entityType: "ai_credential", safeDetail: provider });
        return interactionResponse(res, `Your ${provider} key was validated and encrypted. It will not be shown again.`);
      }

      if (interaction.type === 3) {
        const match = /^maildm:feedback:(up|down):\d+$/.exec(interaction.data?.custom_id ?? "");
        if (match && interaction.message?.id) await recordSummaryFeedback(user.id, interaction.message.id, match[1] as "up" | "down");
        return componentAcknowledgement(res);
      }

      if (interaction.type !== 2 || !interaction.data?.name) return res.status(400).json({ error: "unsupported interaction" });
      const command = interaction.data.name.toLowerCase();
      if (command === "start" || command === "help") return interactionResponse(res, "Welcome to MailDM. Try /sample first. Then, in this private DM: 1) use /connect gmail, 2) choose /set-ai-provider and /set-model, 3) use /set-ai-key, and 4) set /set-time. MailDM only reads Gmail messages that are unread and never changes your inbox.");
      if (!isDirectMessageInteraction(interaction)) return dmOnly(res);

      if (command === "sample") return interactionResponse(res, sampleBrief);

      if (command === "connect") {
        const provider = commandOption(interaction, "provider") ?? "gmail";
        if (provider !== "gmail") return interactionResponse(res, "Gmail is the only source enabled right now. Outlook, Slack, and GitHub will be added later.");
        const label = sanitizeLabel(commandOption(interaction, "label"));
        const url = await createGmailAuthorizationUrl(discordUser.id, label, createOAuthState);
        await recordAuditEvent({ discordUserId: discordUser.id, eventType: "gmail_link_started", entityType: "connected_account", safeDetail: label });
        return interactionResponse(res, `Open this secure Google link to connect the ${label} account. It expires in 15 minutes:\n${url}`);
      }

      if (command === "accounts") {
        const accounts = await listConnectedAccounts(discordUser.id);
        const content = accounts.length === 0 ? "No Gmail accounts are connected yet. Use /connect gmail." : accounts.map(account => `• #${account.id} · ${account.label} — ${account.accountEmail} (${account.status})`).join("\n");
        return interactionResponse(res, content);
      }

      if (command === "disconnect") {
        const accountId = Number(commandOption(interaction, "account_id"));
        const account = Number.isInteger(accountId) ? await getGmailAccount(accountId) : null;
        if (!account || account.discordUserId !== discordUser.id) return interactionResponse(res, "That Gmail account could not be found.", { ephemeral: true });
        await revokeGoogleRefreshToken(account.encryptedRefreshToken).catch(() => false);
        await disconnectAccount(discordUser.id, account.id);
        await recordAuditEvent({ discordUserId: discordUser.id, eventType: "gmail_disconnected", entityType: "connected_account", entityId: String(account.id) });
        return interactionResponse(res, `${account.label} has been disconnected. MailDM will no longer access it.`);
      }

      if (command === "reauthorize") {
        const accountId = Number(commandOption(interaction, "account_id"));
        const account = Number.isInteger(accountId) ? await getGmailAccount(accountId) : null;
        if (!account || account.discordUserId !== discordUser.id) return interactionResponse(res, "That Gmail account could not be found.", { ephemeral: true });
        const url = await createGmailAuthorizationUrl(discordUser.id, account.label, createOAuthState);
        await recordAuditEvent({ discordUserId: discordUser.id, eventType: "gmail_reauthorization_started", entityType: "connected_account", entityId: String(account.id) });
        return interactionResponse(res, `Open this secure Google link to reauthorize ${account.label}. It expires in 15 minutes:\n${url}`);
      }

      if (command === "set-ai-provider") {
        const provider = commandOption(interaction, "provider") ?? "";
        if (!isConfigurableProvider(provider)) return interactionResponse(res, "Choose a supported provider: openai, anthropic, or nvidia.", { ephemeral: true });
        const models = getRecommendedModels(provider);
        await setAiSelection(discordUser.id, provider, models[0]);
        return interactionResponse(res, `${provider} selected. Recommended default: ${models[0]}. Use /set-model to choose another supported model, then /set-ai-key to add your key privately.`);
      }

      if (command === "set-model") {
        if (!discordUser.activeAiProvider || discordUser.activeAiProvider === "compatible") return interactionResponse(res, "First choose a provider with /set-ai-provider.", { ephemeral: true });
        const model = commandOption(interaction, "model") ?? "";
        if (!isRecommendedModel(discordUser.activeAiProvider, model)) return interactionResponse(res, `That is not a recommended ${discordUser.activeAiProvider} model. Use the command picker to select one.`, { ephemeral: true });
        await setAiSelection(discordUser.id, discordUser.activeAiProvider, model);
        return interactionResponse(res, `Model selected: ${model}. Use /set-ai-key to add or replace the ${discordUser.activeAiProvider} API key in this DM.`);
      }

      if (command === "set-ai-key") {
        if (!discordUser.activeAiProvider || discordUser.activeAiProvider === "compatible") return interactionResponse(res, "First choose a provider with /set-ai-provider.", { ephemeral: true });
        return modalResponse(res, `maildm:api-key:${discordUser.activeAiProvider}`, "Secure AI key", `${discordUser.activeAiProvider} API key`);
      }

      if (command === "set-time") {
        const { time, timezone } = scheduleInput(commandOption(interaction, "time"), commandOption(interaction, "timezone"));
        await configureDailySchedule(discordUser.id, time, timezone);
        return interactionResponse(res, `Daily delivery is set for ${time} ${timezone}. MailDM will send “No important unread mail today” when no unread messages qualify.`);
      }

      if (command === "settings") {
        const providerInput = commandOption(interaction, "provider");
        const modelInput = commandOption(interaction, "model");
        const timeInput = commandOption(interaction, "time");
        const timezoneInput = commandOption(interaction, "timezone");
        const updates: string[] = [];
        const selectedProvider = providerInput ?? discordUser.activeAiProvider;

        if (providerInput) {
          if (!isConfigurableProvider(providerInput)) return interactionResponse(res, "Choose a supported provider: openai, anthropic, or nvidia.", { ephemeral: true });
          const nextModel = modelInput ?? getRecommendedModels(providerInput)[0];
          if (!isRecommendedModel(providerInput, nextModel)) return interactionResponse(res, `That is not a recommended ${providerInput} model.`, { ephemeral: true });
          await setAiSelection(discordUser.id, providerInput, nextModel);
          updates.push(`AI: ${providerInput} · ${nextModel}`);
        } else if (modelInput) {
          if (!selectedProvider || !isConfigurableProvider(selectedProvider) || !isRecommendedModel(selectedProvider, modelInput)) return interactionResponse(res, "Choose a matching provider and recommended model, or set the provider first.", { ephemeral: true });
          await setAiSelection(discordUser.id, selectedProvider, modelInput);
          updates.push(`AI model: ${modelInput}`);
        }

        if (timeInput || timezoneInput) {
          if (!timeInput || !timezoneInput) return interactionResponse(res, "To update delivery, provide both time and timezone in the same /settings command.", { ephemeral: true });
          const { time, timezone } = scheduleInput(timeInput, timezoneInput);
          await configureDailySchedule(discordUser.id, time, timezone);
          updates.push(`Daily delivery: ${time} · ${timezone}`);
        }

        if (updates.length > 0) return interactionResponse(res, `**MailDM settings updated**\n${updates.join("\n")}\n\nIf you changed provider or model, run /set-ai-key to validate a key for that provider.`);
        const schedule = await getScheduleByDiscordUserId(discordUser.id);
        const accounts = await listConnectedAccounts(discordUser.id);
        const ai = discordUser.activeAiProvider && discordUser.activeModel ? `${discordUser.activeAiProvider} · ${discordUser.activeModel}` : "Not configured";
        const delivery = schedule ? `${schedule.localTime} · ${schedule.timezone}` : "Not configured";
        return interactionResponse(res, `**Your MailDM settings**\nGmail accounts: ${accounts.length} connected\nAI: ${ai}\nDaily delivery: ${delivery}\n\nUpdate with /set-ai-provider, /set-model, /set-ai-key, or /set-time. Use /accounts to manage Gmail links.`);
      }

      if (command === "summary-now") {
        const schedule = await getScheduleByDiscordUserId(discordUser.id);
        if (!schedule) return interactionResponse(res, "Set your delivery time first with /set-time. This creates the secure daily schedule MailDM also uses for an on-demand brief.", { ephemeral: true });
        deferredInteractionResponse(res);
        void runDigestForSchedule({ scheduleId: schedule.id, discordUserId: discordUser.id, localDate: deliveryDateString(new Date(), schedule.timezone) })
          .then(result => sendDiscordInteractionFollowup(interaction.token, result.status === "delivered" ? "Your MailDM brief has been sent by direct message." : "A brief already exists for this delivery date. Check your direct messages."))
          .catch(() => sendDiscordInteractionFollowup(interaction.token, "MailDM could not create that brief. Check /accounts, /settings, and your AI key, then try again."));
        return;
      }

      if (command === "delete-my-data") {
        if (commandOption(interaction, "confirm") !== "DELETE") return interactionResponse(res, "To permanently delete your MailDM Gmail links, encrypted keys, schedules, summaries, and preferences, run /delete-my-data with confirm set to DELETE.", { ephemeral: true });
        const schedule = await getScheduleByDiscordUserId(discordUser.id);
        if (schedule?.scheduleCronTaskUid) await deleteHeartbeatJob(schedule.scheduleCronTaskUid, "").catch(() => undefined);
        await recordAuditEvent({ discordUserId: discordUser.id, eventType: "user_data_deleted", entityType: "discord_user" });
        await deleteDiscordUserData(user.id);
        return interactionResponse(res, "Your MailDM data has been permanently deleted. Gmail tokens, encrypted AI credentials, account metadata, schedules, summary history, and preferences have been removed.");
      }

      return interactionResponse(res, "That MailDM command is not configured yet. Use /help for the available commands.");
    } catch (error) {
      const message = error instanceof Error && error.message.includes("Google OAuth")
        ? "Google OAuth is not configured yet. Add the exact callback URL and credentials before connecting Gmail."
        : "MailDM could not complete that request. Please try again shortly.";
      return interactionResponse(res, message, { ephemeral: true });
    }
  });
}
