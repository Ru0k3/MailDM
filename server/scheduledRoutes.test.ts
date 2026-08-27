import { describe, expect, it } from "vitest";
import { nextLocalOccurrence, oneTimeUtcCron } from "./scheduledRoutes";
import { NO_IMPORTANT_MAIL_MESSAGE } from "./maildmTypes";

describe("MailDM delivery scheduling", () => {
  it("calculates the next user-local occurrence in UTC", () => {
    const next = nextLocalOccurrence("Asia/Kolkata", "08:00", new Date("2026-08-28T02:00:00.000Z"));
    expect(next.toISOString()).toBe("2026-08-28T02:30:00.000Z");
    expect(oneTimeUtcCron(next)).toBe("0 30 2 28 8 *");
  });

  it("preserves the required no-mail wording exactly", () => {
    expect(NO_IMPORTANT_MAIL_MESSAGE).toBe("No important unread mail today");
  });
});
