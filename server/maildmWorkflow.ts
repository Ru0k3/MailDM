import { getAiAdapter } from "./aiProviders";
import { sendDiscordDirectMessage } from "./discord";
import { decryptCredential } from "./maildmCrypto";
import {
  claimSummaryJob,
  createOrGetSummaryJob,
  failSummaryJob,
  getActiveAiCredential,
  getDiscordUserById,
  getProcessedExternalIds,
  listActiveGmailAccounts,
  markAccountNeedsReauthorization,
  recordProcessedItems,
  saveSummaryHistory,
} from "./maildmDb";
import { SUMMARY_LIMITS } from "./maildmConfig";
import { gmailSourceAdapter } from "./gmail";
import { NO_IMPORTANT_MAIL_MESSAGE, type StructuredBrief } from "./maildmTypes";

function truncateForDiscord(content: string) {
  return content.length <= SUMMARY_LIMITS.maxDiscordMessageCharacters
    ? content
    : `${content.slice(0, SUMMARY_LIMITS.maxDiscordMessageCharacters - 1).trimEnd()}…`;
}

function formatBrief(brief: StructuredBrief) {
  if (brief.noImportantMail || brief.items.length === 0) return NO_IMPORTANT_MAIL_MESSAGE;
  const lines = [`**${brief.headline}**`, brief.overview, ""];
  brief.items.forEach((item, index) => {
    lines.push(`**${index + 1}. [${item.sourceLabel}] ${item.subject}**`);
    lines.push(`${item.summary} _${item.reason}_`);
  });
  return truncateForDiscord(lines.join("\n"));
}

function feedbackComponents(jobId: number) {
  return [{
    type: 1,
    components: [
      { type: 2, style: 2, label: "Helpful", emoji: { name: "👍" }, custom_id: `maildm:feedback:up:${jobId}` },
      { type: 2, style: 2, label: "Not helpful", emoji: { name: "👎" }, custom_id: `maildm:feedback:down:${jobId}` },
    ],
  }];
}

export function deliveryDateInTimezone(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date)
    .reduce((value, part) => part.type === "literal" ? value : { ...value, [part.type]: part.value }, {} as Record<string, string>);
}

export function deliveryDateString(date: Date, timezone: string) {
  const parts = deliveryDateInTimezone(date, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export async function runDigestForSchedule(input: { scheduleId: number; discordUserId: number; localDate: string }) {
  const idempotencyKey = `digest:${input.scheduleId}:${input.localDate}`;
  const job = await createOrGetSummaryJob(input.scheduleId, input.discordUserId, input.localDate, idempotencyKey);
  if (!job || job.status === "delivered") return { status: "already_delivered" as const };
  if (!(await claimSummaryJob(job.id))) return { status: "already_claimed" as const };

  try {
    const user = await getDiscordUserById(input.discordUserId);
    if (!user) throw new Error("discord_user_missing");
    const accounts = await listActiveGmailAccounts(user.id);
    const processed = await getProcessedExternalIds(accounts.map(account => account.id));
    const unreadItems = [];
    const reauthorizationNeeded: Array<{ id: number; label: string }> = [];
    for (const account of accounts) {
      try {
        const items = await gmailSourceAdapter.fetchUnreadItems({
          accountId: account.id,
          encryptedRefreshToken: account.encryptedRefreshToken,
          limits: SUMMARY_LIMITS,
          processedExternalIds: processed.get(account.id) ?? new Set<string>(),
        });
        unreadItems.push(...items.map(item => ({ ...item, sourceLabel: account.label })));
      } catch (error) {
        const safeCode = error instanceof Error ? error.message.split(" ")[0].slice(0, 80) : "gmail_fetch_failed";
        await markAccountNeedsReauthorization(account.id, safeCode);
        reauthorizationNeeded.push({ id: account.id, label: account.label });
      }
    }

    if (unreadItems.length === 0 && reauthorizationNeeded.length > 0) {
      const followUp = reauthorizationNeeded.map(account => `#${account.id} ${account.label}`).join(", ");
      const delivery = await sendDiscordDirectMessage(user.discordUserId, `MailDM needs you to reauthorize: ${followUp}. Open a private DM with MailDM and use /reauthorize <account_id>.`, { components: feedbackComponents(job.id) });
      await saveSummaryHistory({ jobId: job.id, discordUserId: user.id, headline: "Gmail reauthorization required", overview: "One or more Gmail accounts could not be refreshed.", itemCount: 0, noImportantMail: false, discordMessageId: delivery.deliveryId });
      return { status: "reauthorization_required" as const, itemCount: 0 };
    }

    const credential = unreadItems.length > 0 ? await getActiveAiCredential(user.id) : null;
    if (unreadItems.length > 0 && !credential) throw new Error("ai_configuration_missing");
    const brief: StructuredBrief = unreadItems.length === 0
      ? { headline: NO_IMPORTANT_MAIL_MESSAGE, overview: NO_IMPORTANT_MAIL_MESSAGE, items: [], noImportantMail: true }
      : await getAiAdapter(credential!.provider).createBrief({ apiKey: decryptCredential(credential!.encryptedApiKey), model: credential!.model, items: unreadItems });

    const warning = reauthorizationNeeded.length > 0 ? `\n\nAction required: reauthorize ${reauthorizationNeeded.map(account => `#${account.id} ${account.label}`).join(", ")} with /reauthorize <account_id>.` : "";
    const delivery = await sendDiscordDirectMessage(user.discordUserId, truncateForDiscord(`${formatBrief(brief)}${warning}`), { components: feedbackComponents(job.id) });
    for (const account of accounts) {
      await recordProcessedItems(account.id, unreadItems.filter(item => item.sourceAccountId === account.id).map(item => item.externalId), job.id);
    }
    await saveSummaryHistory({ jobId: job.id, discordUserId: user.id, headline: brief.noImportantMail ? NO_IMPORTANT_MAIL_MESSAGE : brief.headline, overview: brief.noImportantMail ? NO_IMPORTANT_MAIL_MESSAGE : brief.overview, itemCount: brief.items.length, noImportantMail: brief.noImportantMail, discordMessageId: delivery.deliveryId });
    return { status: "delivered" as const, itemCount: brief.items.length };
  } catch (error) {
    const safeCode = error instanceof Error ? error.message.split(" ")[0].slice(0, 80) : "digest_failed";
    await failSummaryJob(job.id, safeCode);
    throw error;
  }
}
