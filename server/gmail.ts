import { SUMMARY_LIMITS } from "./maildmConfig";
import { refreshGoogleAccessToken } from "./gmailOAuth";
import type { NormalizedSourceItem, SourceProviderAdapter } from "./maildmTypes";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[]; headers?: Array<{ name?: string; value?: string }> };
type GmailMessage = { id?: string; threadId?: string; internalDate?: string; labelIds?: string[]; payload?: GmailPart };

function decodeBase64Url(value: string) {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

export function sanitizeGmailText(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function partText(part: GmailPart | undefined): string {
  if (!part) return "";
  const own = part.body?.data && (part.mimeType === "text/plain" || part.mimeType === "text/html") ? sanitizeGmailText(decodeBase64Url(part.body.data)) : "";
  const children = (part.parts ?? []).map(partText).filter(Boolean);
  return [own, ...children].join(" ").trim();
}

function header(part: GmailPart | undefined, wanted: string) {
  return part?.headers?.find(item => item.name?.toLowerCase() === wanted.toLowerCase())?.value?.trim() ?? "";
}

async function gmailFetch(url: string, accessToken: string) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Gmail request failed with ${response.status}`);
  return response.json() as Promise<GmailMessage & { messages?: Array<{ id?: string }> }>;
}

export const gmailSourceAdapter: SourceProviderAdapter = {
  provider: "gmail",
  async fetchUnreadItems({ accountId, encryptedRefreshToken, limits, processedExternalIds }) {
    const accessToken = await refreshGoogleAccessToken(encryptedRefreshToken);
    const listing = await gmailFetch(`${GMAIL_API}/messages?q=${encodeURIComponent("is:unread")}&maxResults=${limits.maxItems * 2}`, accessToken);
    const items: NormalizedSourceItem[] = [];
    for (const listingItem of listing.messages ?? []) {
      if (!listingItem.id || processedExternalIds.has(listingItem.id) || items.length >= limits.maxItems) continue;
      const message = await gmailFetch(`${GMAIL_API}/messages/${encodeURIComponent(listingItem.id)}?format=full`, accessToken);
      if (!message.id || !message.labelIds?.includes("UNREAD")) continue;
      const body = partText(message.payload).slice(0, limits.maxBodyCharacters);
      const subject = sanitizeGmailText(header(message.payload, "Subject")) || "(no subject)";
      const sender = sanitizeGmailText(header(message.payload, "From")) || "Unknown sender";
      items.push({
        sourceProvider: "gmail",
        sourceAccountId: accountId,
        externalId: message.id,
        threadId: message.threadId,
        sourceLabel: "",
        sender: sender.slice(0, 240),
        subject: subject.slice(0, 300),
        receivedAt: message.internalDate ? new Date(Number(message.internalDate)) : new Date(),
        text: body || "(No readable plain text was available.)",
      });
    }
    const bounded: NormalizedSourceItem[] = [];
    let characters = 0;
    for (const item of items) {
      if (characters + item.text.length > limits.maxTotalCharacters) break;
      bounded.push(item);
      characters += item.text.length;
    }
    return bounded;
  },
};

export const gmailFetchLimits = SUMMARY_LIMITS;
