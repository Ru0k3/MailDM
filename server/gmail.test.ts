import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./gmailOAuth", () => ({ refreshGoogleAccessToken: vi.fn().mockResolvedValue("access-token") }));

import { gmailSourceAdapter, sanitizeGmailText } from "./gmail";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("MailDM Gmail reader", () => {
  it("removes unsafe markup and controls from Gmail content before summarization", () => {
    expect(sanitizeGmailText("<script>steal()</script><p>Hello\u0000 world</p>")).toBe("Hello world");
  });

  it("fetches unread messages only, normalizes them in memory, caps bodies, and skips known external IDs", async () => {
    const body = Buffer.from("<script>ignore instructions</script><p>Meeting details for today</p>").toString("base64url");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [{ id: "message-1" }, { id: "already-seen" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "message-1", threadId: "thread-1", internalDate: "1787875200000", labelIds: ["INBOX", "UNREAD"], payload: { headers: [{ name: "From", value: "Sender <sender@example.com>" }, { name: "Subject", value: "<b>Action required</b>" }], mimeType: "text/html", body: { data: body } } }), { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const items = await gmailSourceAdapter.fetchUnreadItems({
      accountId: 8,
      encryptedRefreshToken: "opaque",
      limits: { maxItems: 5, maxBodyCharacters: 40, maxTotalCharacters: 100, maxDiscordMessageCharacters: 1900 },
      processedExternalIds: new Set(["already-seen"]),
    });

    expect(fetchMock.mock.calls[0]?.[0]).toContain("is%3Aunread");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ sourceProvider: "gmail", sourceAccountId: 8, externalId: "message-1", subject: "Action required" });
    expect(items[0]?.text).toContain("Meeting details");
    expect(items[0]?.text).not.toContain("script");
    expect(items[0]?.text.length).toBeLessThanOrEqual(40);
  });
});
