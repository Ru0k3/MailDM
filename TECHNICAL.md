# MailDM Technical Documentation

This document describes the implementation and operational behavior of MailDM for contributors and operators. The friendly setup guide is in [README.md](README.md).

## Multi-provider BYOK support

MailDM supports bring-your-own-key (BYOK) credentials. A user adds a provider credential with `/set-ai-key` in a Discord direct message, and then chooses an available model with `/models` and `/set-model`. The supported provider choices are OpenAI, Anthropic, OpenRouter, and a labeled custom OpenAI-compatible HTTPS endpoint.

Provider selection is explicit. MailDM does not infer a provider from an API-key prefix. The `/set-ai-key` flow validates the credential by requesting the provider's model list before storing it. Custom endpoints must use HTTPS and are rejected when they target localhost, private or link-local networks, metadata services, or URLs containing embedded credentials.

Credentials are encrypted with AES-256-GCM using `SESSION_SECRET` before they are stored in the `ai_credentials` table. Gmail access and refresh tokens are encrypted with the same application secret. The API key is not returned by credential-listing responses. Model and credential selection uses short-lived opaque server-side tokens rather than exposing secrets or base URLs in Discord buttons.

The legacy `settings.ai_provider`, `settings.ai_model`, and `settings.ai_api_key` columns remain for one migration release. On first credential lookup, a legacy single-key configuration is bridged into `ai_credentials`. `/set-ai-provider` remains available as a legacy provider preference; the current credential workflow is `/set-ai-key`, `/models`, and `/set-model`.

### Exact model-ID fallback

`/models` creates selection buttons for only the first 20 cached models per credential, plus the credential-removal control. This keeps the Discord component payload within Discord's 25-component limit. If a provider returns a large catalog, such as NVIDIA returning 50 or more cached models for one credential, a model may be cached but not rendered as a button. In that case, `/set-model` also accepts the model's exact cached model ID directly in the `selection` field. If that exact ID matches one cached model for the user, MailDM activates it without requiring a button-generated token.

## External scheduler trigger

MailDM does not run an in-process interval for scheduled summaries. The hosting platform may scale the application to zero, so an external scheduler must wake the application periodically.

The protected endpoint is:

```text
POST https://YOUR_PUBLISHED_MAILDM_URL/api/scheduler/tick
X-Scheduler-Secret: YOUR_SCHEDULER_SECRET
Content-Length: 0
```

The handler validates `X-Scheduler-Secret` against `SCHEDULER_SECRET` with constant-time comparison before touching the database or scheduler. Missing or incorrect secrets receive HTTP `401` and produce no scheduler side effects. The endpoint is not part of the Discord command surface or public user-facing pages.

The default due window is ten minutes, controlled by `SCHEDULER_DUE_WINDOW_MINUTES`. A scheduler should normally call the endpoint every five minutes. **cron-job.org is only a suggested option; it is not configured or confirmed as in use by this repository.** No cron-job.org job configuration is stored in source control. Railway Cron, GitHub Actions, or another trusted scheduler can also call the endpoint if its timing and secret storage are appropriate. The repository contains a GitHub Actions workflow file as an alternative, but enabling that workflow and supplying its secrets are deployment steps, not application configuration. GitHub scheduled workflows are best-effort and may be delayed.

Each scheduled attempt claims `(user_id, local_date, delivery_kind='scheduled')` in `summary_history`. The unique constraint prevents duplicate delivery for the same user and local calendar date. The production MySQL/TiDB store uses a transactional `SELECT ... FOR UPDATE` claim, so the invariant holds across concurrent application instances. A transient pre-delivery failure can receive one bounded retry. Reauthorization failures, missing accounts, permanent AI authentication failures, and any failure after Discord delivery was attempted are not retried.

The scheduler evaluates each user's configured wall-clock time and IANA timezone. It does not use one global UTC fire time, and its local-date calculation follows timezone and daylight-saving transitions.

## Pipeline failure handling

The `/summary-now` interaction and the scheduled tick share `runSummaryForUser`. The pipeline reads Gmail, filters out already processed message IDs, summarizes the remaining messages through the selected provider, and delivers the result to Discord.

Discord interactions use a deferred-response pattern. MailDM acknowledges the interaction quickly with Discord response type `5`, then performs database, Gmail, provider, and delivery work. When the work finishes, it edits the original deferred response. Longer summaries are sent as a first edited response followed by webhook follow-ups. The last message receives the feedback buttons; earlier chunks do not.

The Discord content limit used by the application is 1,900 characters per chunk. The splitter prefers a blank-line boundary between per-email blocks when that boundary is available within the limit. If a single email block is longer than the limit or no suitable blank-line boundary exists, it falls back to a hard character split. Chunking therefore remains safe for long summaries without requiring the summarizer to know Discord's transport limit.

The summarizer produces one four-line block per email, in fetch order: the actual subject header, `Key points`, `Action items`, and `Risks`. Email content remains untrusted data even when the model analyzes messages independently. Prompt-injection text is never treated as an instruction and may be mentioned under `Risks` when it is suspicious content.

Provider failures are normalized into `AI_FAILURE` or `AI_AUTH_FAILURE`. Authentication failures cause the user-facing response to direct the user to `/models` and `/set-ai-key`. Gmail authorization failures mark the account as requiring reauthorization and produce a `/reauthorize` notice. Discord delivery failures use `DISCORD_DM_FAILURE` and are passed to the scheduler failure hook instead of being silently swallowed.

Processed-item deduplication uses `(gmail_account_id, external_id)` in `processed_source_items`. A message is added to this table only after summarization and delivery succeed. If provider or delivery work fails, the message remains eligible for a later attempt. The production database enforces uniqueness with an InnoDB unique key; the SQLite helper uses the equivalent unique constraint for tests.

## Security and data handling

Discord interaction requests are accepted only when the Ed25519 signature over `timestamp + raw request body` validates against `DISCORD_PUBLIC_KEY`. OAuth state is signed with `SESSION_SECRET`, which prevents an authorization callback from being attached to an arbitrary Discord user.

Gmail access uses only the `https://www.googleapis.com/auth/gmail.readonly` scope. MailDM reads messages to prepare summaries and does not send, modify, or delete Gmail messages. OAuth access and refresh tokens are encrypted at rest. User-provided AI credentials are encrypted at rest and are not printed in logs or returned through model-selection responses.

Credential commands are DM-only. Discord displays command parameters in a guild channel, so accepting an API key there could expose the key to other channel members. MailDM rejects `/set-ai-key`, `/models`, `/set-model`, and `/remove-api-key` outside direct messages.

The summarizer system policy treats subjects, bodies, sender names, links, attachments, and quoted content as untrusted data. It explicitly rejects requests in email content to override the policy, impersonate another message role, call tools, send mail, change settings, reveal secrets, or change the summarization task. Email fields are enclosed in an untrusted-data boundary, and `&`, `<`, and `>` are escaped before being placed in the prompt.

Two temporary admin diagnostic endpoints exist for maintenance and are secret-gated with `ADMIN_DIAGNOSTIC_SECRET`:

- `GET /admin/diagnostics/processed-items` reads processed-item rows for one hardcoded maintenance account.
- `POST /admin/diagnostics/processed-items/reset-account` deletes processed-item rows for that same hardcoded account and returns the deleted-row count.

These endpoints are temporary, should not be exposed as general product features, and the secret value must never be written in this document, source control, logs, or public issue reports. The reset endpoint is POST-only to avoid accidental activation by browser navigation or prefetching.

## Google OAuth setup

Create a Google Cloud project for the deployment and enable the Gmail API. Configure the Google Auth Platform branding and consent-screen details, including the application name, support contact, authorized domain where applicable, privacy policy URL, and terms URL.

Create a Web application OAuth client. Add the exact callback URL from `GOOGLE_REDIRECT_URI` to the client's authorized redirect URIs. For local development this may be:

```text
http://localhost:3000/auth/google/callback
```

For production, use the deployed HTTPS callback URL. Set the resulting client ID and client secret as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Set `APP_BASE_URL` to the public application base URL so the successful callback can redirect to the connected page.

MailDM requests only:

```text
https://www.googleapis.com/auth/gmail.readonly
```

The OAuth start route creates a signed state containing the Discord user ID and requests offline access so Google can issue a refresh token. The callback exchanges the authorization code, reads the authorized Gmail profile, encrypts the received tokens, and stores the account against the Discord user.

## Discord command registration

`npm run register:commands` reads `DISCORD_APPLICATION_ID` and `DISCORD_BOT_TOKEN`. With `DISCORD_REGISTER_GUILD_ID` unset, it uses Discord's global application-command endpoint. This is the normal configuration and is required for DM-only commands to be discoverable in direct messages.

The script still accepts `DISCORD_REGISTER_GUILD_ID` as an optional local-testing override for faster propagation in a development server. It should be left unset in normal production configuration. Regardless of registration scope, the application enforces DM-only behavior at request handling time for credential commands.

## References

[1]: https://discord.com/developers/docs/interactions/receiving-and-responding "Discord receiving and responding to interactions"
[2]: https://developers.google.com/gmail/api/auth/scopes "Gmail API OAuth scopes"
[3]: https://developers.google.com/identity/protocols/oauth2 "Google OAuth 2.0 documentation"
[4]: https://dev.mysql.com/doc/refman/8.0/en/innodb-locking-reads.html "MySQL InnoDB locking reads"
