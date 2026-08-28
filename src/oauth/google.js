import { google } from 'googleapis';
import { createSignedState, verifySignedState, encryptSecret } from '../security/index.js';

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export function makeOAuthClient(env = process.env) {
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
}

export function registerGoogleRoutes(app, { store, env = process.env, oauthClient = null }) {
  const client = oauthClient ?? makeOAuthClient(env);
  app.get('/auth/google/start', (req, res) => {
    const discordUserId = String(req.query.discord_user_id ?? '');
    if (!discordUserId) return res.status(400).send('Missing discord_user_id');
    const state = createSignedState(env.SESSION_SECRET, discordUserId);
    const url = client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: [GMAIL_READONLY_SCOPE], state });
    return res.redirect(url);
  });

  app.get('/auth/google/callback', async (req, res) => {
    const discordUserId = verifySignedState(env.SESSION_SECRET, String(req.query.state ?? ''));
    if (!discordUserId) return res.status(400).send('Invalid OAuth state');
    if (req.query.error) return res.status(400).send(`Google authorization failed: ${req.query.error}`);
    try {
      const { tokens } = await client.getToken(String(req.query.code ?? ''));
      client.setCredentials(tokens);
      const gmail = google.gmail({ version: 'v1', auth: client });
      const profile = await gmail.users.getProfile({ userId: 'me' });
      const tokenInfo = await client.getTokenInfo(tokens.access_token ?? '');
      await store.saveGmailAccount(discordUserId, {
        googleSub: tokenInfo.sub ?? profile.data.emailAddress,
        email: profile.data.emailAddress,
        accessToken: encryptSecret(tokens.access_token, env.SESSION_SECRET),
        refreshToken: encryptSecret(tokens.refresh_token, env.SESSION_SECRET),
        expiryDate: tokens.expiry_date,
        scopes: tokenInfo.scopes ?? [GMAIL_READONLY_SCOPE]
      });
      return res.redirect(`${env.APP_BASE_URL ?? ''}/connected`);
    } catch (error) {
      console.error('Google OAuth callback failed', error);
      return res.status(502).send('Could not complete Google authorization');
    }
  });
}
