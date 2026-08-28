import { isDueAt, localScheduleParts } from './time.js';
import { runSummaryForUser, PipelineError } from '../summarizer/pipeline.js';
import { deliverDiscordDM } from '../discord/delivery.js';

export class SummaryScheduler {
  constructor({ store, env = process.env, now = () => new Date(), dueWindowMinutes = Number(env.SCHEDULER_DUE_WINDOW_MINUTES ?? 10), pipeline = runSummaryForUser, deliver = deliverDiscordDM, notify = deliverDiscordDM, onFailure = (failure) => console.error('Scheduled summary failed', failure) }) {
    this.store = store;
    this.env = env;
    this.now = now;
    this.dueWindowMinutes = dueWindowMinutes;
    this.pipeline = pipeline;
    this.deliver = deliver;
    this.notify = notify;
    this.onFailure = onFailure;
    this.running = false;
  }

  async tick(now = this.now()) {
    if (this.running) return { skipped: 'already_running' };
    this.running = true;
    const result = { checked: 0, claimed: 0, completed: 0, failed: 0 };
    try {
      for (const recipient of await this.store.listScheduledRecipients()) {
        result.checked += 1;
        if (!isDueAt({ now, summaryTime: recipient.summaryTime, timeZone: recipient.timezone, windowMinutes: this.dueWindowMinutes })) continue;
        const local = localScheduleParts(now, recipient.timezone);
        const claim = await this.store.claimScheduledSummary(recipient.discordUserId, local.localDate);
        if (!claim.claimed) continue;
        result.claimed += 1;
        let deliveryAttempted = false;
        try {
          const pipelineResult = await this.pipeline({ discordUserId: recipient.discordUserId, store: this.store, env: this.env });
          await this.store.markDeliveryAttempted(recipient.discordUserId, local.localDate);
          deliveryAttempted = true;
          await this.deliver({ discordUserId: recipient.discordUserId, content: pipelineResult.summary, env: this.env });
          await this.store.completeScheduledSummary(recipient.discordUserId, local.localDate, pipelineResult.summary);
          result.completed += 1;
        } catch (error) {
          result.failed += 1;
          const code = error instanceof PipelineError ? error.code : error.code ?? 'DELIVERY_FAILURE';
          await this.store.failScheduledSummary(recipient.discordUserId, local.localDate, code, deliveryAttempted);
          const failure = { discordUserId: recipient.discordUserId, localDate: local.localDate, code, error };
          this.onFailure(failure);
          if (code === 'REAUTH_REQUIRED') {
            try { await this.notify({ discordUserId: recipient.discordUserId, content: 'Your Gmail authorization needs attention. Use `/reauthorize` in Discord to reconnect it.', env: this.env }); } catch (notifyError) { this.onFailure({ ...failure, code: 'NOTIFICATION_FAILURE', error: notifyError }); }
          } else if (code === 'AI_FAILURE' || code === 'AI_AUTH_FAILURE') {
            try { await this.notify({ discordUserId: recipient.discordUserId, content: 'Your AI provider or API key needs attention. Check `/settings` and update it before the next scheduled brief.', env: this.env }); } catch (notifyError) { this.onFailure({ ...failure, code: 'NOTIFICATION_FAILURE', error: notifyError }); }
          }
        }
      }
      return result;
    } finally { this.running = false; }
  }
}
