import { google } from 'googleapis';
import { decryptSecret } from '../security/index.js';
import { buildUnreadWeekQuery } from './query.js';

function decodeBase64Url(value = '') {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function findBody(payload) {
  if (!payload) return '';
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  for (const part of payload.parts ?? []) {
    const body = findBody(part);
    if (body) return body;
  }
  return '';
}

function header(headers = [], name) {
  return headers.find((item) => item.name?.toLowerCase() === name)?.value ?? '';
}

export function makeGmailAdapter({ account, env = process.env }) {
  const auth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
  auth.setCredentials({
    access_token: decryptSecret(account.accessToken, env.SESSION_SECRET),
    refresh_token: decryptSecret(account.refreshToken, env.SESSION_SECRET),
    expiry_date: account.expiryDate ?? undefined
  });
  const gmail = google.gmail({ version: 'v1', auth });

  return {
    async listRecentMessages({ maxResults = 10, query = buildUnreadWeekQuery() } = {}) {
      const listed = await gmail.users.messages.list({ userId: 'me', maxResults, q: query });
      const messages = [];
      for (const item of listed.data.messages ?? []) {
        const full = await gmail.users.messages.get({ userId: 'me', id: item.id, format: 'full' });
        const payload = full.data.payload;
        messages.push({
          id: full.data.id,
          threadId: full.data.threadId,
          from: header(payload?.headers, 'from'),
          to: header(payload?.headers, 'to'),
          subject: header(payload?.headers, 'subject'),
          date: header(payload?.headers, 'date'),
          snippet: full.data.snippet ?? '',
          body: findBody(payload)
        });
      }
      return messages;
    }
  };
}
