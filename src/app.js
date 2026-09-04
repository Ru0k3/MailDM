import express from 'express';
import { verifyDiscordRequest, verifySchedulerSecret } from './security/index.js';
import { registerGoogleRoutes } from './oauth/google.js';
import { handleInteraction } from './discord/commands.js';
import { sendDiscordWebhookFollowUp } from './discord/delivery.js';

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`;

export function createApp({ store, env = process.env, oauthClient = null, fetchImpl = fetch, gmailAdapterFactory, summarizerFactory, scheduler = null } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ verify: (req, _res, buffer) => { req.rawBody = buffer.toString('utf8'); } }));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/', (_req, res) => res.type('html').send(page('MailDM', '<p>Gmail-only email summaries in Discord.</p><p><a href="/gmail-readiness">Gmail readiness</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>')));
  app.get('/connected', (_req, res) => res.type('html').send(page('Gmail connected', '<p>Your Gmail account is connected. You can return to Discord.</p>')));
  app.get('/sample', (_req, res) => res.type('html').send(page('Sample summary', '<p>Key points, explicit action items, and risks are separated from untrusted email content.</p>')));
  app.get('/settings', (_req, res) => res.type('html').send(page('Settings', '<p>Settings are managed privately through Discord slash commands.</p>')));
  app.get('/summary-now', (_req, res) => res.type('html').send(page('Summary now', '<p>Use <code>/summary-now</code> in Discord.</p>')));
  app.get('/privacy', (_req, res) => res.type('html').send(page('Privacy Policy', '<p>MailDM requests Gmail read-only access, uses it only to prepare summaries, encrypts stored tokens, and does not send, modify, or delete Gmail messages. Users can disconnect Gmail or delete all MailDM data with Discord commands.</p>')));
  app.get('/terms', (_req, res) => res.type('html').send(page('Terms of Service', '<p>MailDM is provided as-is. Users are responsible for the email accounts and AI provider keys they connect. Do not use MailDM for emergencies or as a substitute for reviewing original email.</p>')));
  app.get('/gmail-readiness', (_req, res) => res.type('html').send(page('Gmail OAuth readiness', '<h2>Requested scope</h2><p><code>https://www.googleapis.com/auth/gmail.readonly</code></p><h2>Data handling</h2><p>Email content is sent only to the selected AI provider for the requested summary. Email content is treated as untrusted data and never as instructions.</p><h2>User controls</h2><p>Use <code>/disconnect</code> to purge an account or <code>/delete-my-data</code> to remove all MailDM records.</p>')));

  registerGoogleRoutes(app, { store, env, oauthClient });

  app.post('/api/scheduler/tick', async (req, res) => {
    if (!verifySchedulerSecret(req.header('x-scheduler-secret'), env.SCHEDULER_SECRET)) return res.status(401).json({ error: 'unauthorized' });
    if (!scheduler) return res.status(503).json({ error: 'scheduler_unavailable' });
    try { return res.json(await scheduler.tick()); }
    catch (error) { console.error('Scheduler tick failed', error); return res.status(500).json({ error: 'scheduler_failed' }); }
  });

  async function editDeferredResponse(interaction, response) {
    const applicationId = env.DISCORD_APPLICATION_ID;
    if (!applicationId || !interaction.token) throw new Error('Discord interaction webhook configuration is missing');
    const webhookUrl = `https://discord.com/api/v10/webhooks/${applicationId}/${interaction.token}/messages/@original`;
    const webhookResponse = await fetchImpl(webhookUrl, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(response?.data ?? { content: 'Something went wrong while handling that command.', flags: 64 })
    });
    if (!webhookResponse.ok) {
      let responseBody;
      try {
        if (typeof webhookResponse.text === 'function') {
          responseBody = await webhookResponse.text();
        } else {
          responseBody = await webhookResponse.json();
        }
      } catch (bodyError) {
        try {
          responseBody = await webhookResponse.json();
        } catch (jsonError) {
          responseBody = `[unable to read Discord response body: ${bodyError.message}; JSON fallback failed: ${jsonError.message}]`;
        }
      }
      console.error('Discord interaction webhook edit failed', {
        status: webhookResponse.status,
        responseBody
      });
      throw new Error(`Discord interaction webhook edit failed: ${webhookResponse.status}`);
    }
  }

  app.post('/interactions', async (req, res) => {
    const valid = verifyDiscordRequest(req.rawBody, req.header('x-signature-ed25519'), req.header('x-signature-timestamp'), env.DISCORD_PUBLIC_KEY);
    if (!valid) return res.status(401).send('invalid request signature');
    if (req.body?.type === 1) return res.json({ type: 1 });

    // Discord requires the initial interaction acknowledgement within roughly three seconds.
    // Send the defer before any database, provider, or other external work.
    res.json({ type: 5 });

    try {
      let response;
      if (req.body?.type === 3) {
        const customId = String(req.body.data?.custom_id ?? '');
        const [prefix, rating] = customId.split(':');
        if (prefix === 'feedback' && (rating === 'helpful' || rating === 'not_helpful')) {
          await store.recordFeedback(req.body.member?.user?.id ?? req.body.user?.id, req.body.message?.id, rating);
          response = { type: 4, data: { content: 'Thanks for the feedback.', flags: 64 } };
        }
      }
      if (!response) response = await handleInteraction(req.body, { store, env, fetchImpl, gmailAdapterFactory, summarizerFactory });
      await editDeferredResponse(req.body, response);
      for (const data of response?.followUpContents ?? []) {
        await sendDiscordWebhookFollowUp({
          applicationId: env.DISCORD_APPLICATION_ID,
          interactionToken: req.body.token,
          data,
          fetchImpl
        });
      }
      if (typeof response?.recordProcessedItems === 'function') {
        await response.recordProcessedItems();
      }
    } catch (error) {
      console.error('Interaction failed', error);
      try {
        await editDeferredResponse(req.body, { type: 4, data: { content: 'Something went wrong while handling that command.', flags: 64 } });
      } catch (editError) {
        console.error('Interaction error response failed', editError);
      }
    }
  });
  return app;
}
