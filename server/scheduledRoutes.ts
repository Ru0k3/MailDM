import type { Express, Request, Response } from "express";
import { sdk } from "./_core/sdk";
import { updateHeartbeatJob } from "./_core/heartbeat";
import { getScheduleByTaskUid } from "./maildmDb";
import { deliveryDateString, runDigestForSchedule } from "./maildmWorkflow";

function parseLocalTime(localTime: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(localTime);
  if (!match) throw new Error("invalid schedule time");
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function nextLocalOccurrence(timezone: string, localTime: string, from = new Date()) {
  const { hour, minute } = parseLocalTime(localTime);
  const start = new Date(from.getTime() + 60_000);
  start.setUTCSeconds(0, 0);
  for (let offset = 0; offset < 48 * 60; offset += 1) {
    const candidate = new Date(start.getTime() + offset * 60_000);
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(candidate);
    const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
    if (values.hour === hour && values.minute === minute) return candidate;
  }
  throw new Error("Could not calculate the next local schedule occurrence");
}

export function oneTimeUtcCron(date: Date) {
  return `0 ${date.getUTCMinutes()} ${date.getUTCHours()} ${date.getUTCDate()} ${date.getUTCMonth() + 1} *`;
}

export function registerScheduledRoutes(app: Express) {
  app.post("/api/scheduled/digest", async (req: Request, res: Response) => {
    try {
      const caller = await sdk.authenticateRequest(req);
      if (!caller.isCron || !caller.taskUid) return res.status(403).json({ error: "cron-only" });
      const schedule = await getScheduleByTaskUid(caller.taskUid);
      if (!schedule || schedule.status !== "active") return res.json({ ok: true, skipped: "orphan_or_paused" });
      const localDate = deliveryDateString(new Date(), schedule.timezone);
      try {
        const result = await runDigestForSchedule({ scheduleId: schedule.id, discordUserId: schedule.discordUserId, localDate });
        const next = nextLocalOccurrence(schedule.timezone, schedule.localTime);
        await updateHeartbeatJob(caller.taskUid, { cron: oneTimeUtcCron(next), path: "/api/scheduled/digest", description: `MailDM daily digest for schedule ${schedule.id}` }, "");
        return res.json({ ok: true, result, nextRunAt: next.toISOString() });
      } catch (error) {
        const retryAt = new Date(Date.now() + 10 * 60 * 1000);
        await updateHeartbeatJob(caller.taskUid, { cron: oneTimeUtcCron(retryAt), path: "/api/scheduled/digest", description: `MailDM retry for schedule ${schedule.id}` }, "");
        return res.json({ ok: false, retryScheduledAt: retryAt.toISOString(), safeCode: error instanceof Error ? error.message.split(" ")[0].slice(0, 80) : "digest_failed" });
      }
    } catch (error) {
      return res.status(500).json({ error: "digest_callback_failed", safeCode: error instanceof Error ? error.message.split(" ")[0].slice(0, 80) : "unknown" });
    }
  });
}
