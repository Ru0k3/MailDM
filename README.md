# MailDM

MailDM is a Gmail-only Discord email summarizer MVP. It exposes an Express health endpoint, Google OAuth start/callback routes, a Discord interactions endpoint for slash commands and feedback controls, and a protected scheduler tick endpoint suitable for Manus Autoscale hosting.

## Commands

The command set is `/sample`, `/connect`, `/accounts`, `/disconnect`, `/settings`, `/set-time`, `/set-ai-provider`, `/set-model`, `/set-ai-key`, `/summary-now`, `/delete-my-data`, and `/reauthorize`. The `disconnect` command removes only the selected Gmail account and its stored tokens; it preserves the user row, settings, summary history, and feedback even when it was the last account. Only `delete-my-data` removes the user row and all cascading data.

`/set-time` accepts a 24-hour time plus an optional IANA timezone, such as `09:00` and `America/New_York`.

## External scheduler trigger

The app no longer starts an in-process `setInterval`. Manus Autoscale may scale the app to zero while idle, so an external scheduler must wake the app periodically. The protected endpoint is:

```text
POST https://YOUR_PUBLISHED_MAILDM_URL/api/scheduler/tick
X-Scheduler-Secret: YOUR_SCHEDULER_SECRET
Content-Length: 0
```

The handler checks `X-Scheduler-Secret` against `SCHEDULER_SECRET` using constant-time comparison **before** touching the database or scheduler. Missing or incorrect secrets receive HTTP `401` and produce no side effects. The endpoint is not listed in the public user-facing pages or Discord API surface.

The default due window is ten minutes (`SCHEDULER_DUE_WINDOW_MINUTES=10`). The external scheduler should run every five minutes. If a cold start or temporary delay means a request arrives several minutes after the user’s configured local time, the user is still considered due during the window. Every scheduled attempt first claims `(user_id, local_date, delivery_kind='scheduled')` in `summary_history`; the SQLite `UNIQUE` constraint means a retry or an overlapping external request cannot deliver two briefs for the same user and local calendar date.

A failed claim may be retried once only when the failure occurred before delivery was attempted and the row has `attempt_count=1`; reauthorization, no-account, and permanent AI-key authentication failures (HTTP 401/403) are not retried. Transient provider failures remain eligible for the one bounded retry. Immediately before calling Discord, the row is marked `delivery_attempted=1`. Any delivery-side failure is permanently non-retryable for that local date because the request may have reached Discord. This prevents duplicate delivery when a response is lost after a message may have been accepted.

For production Autoscale, the production entrypoint uses the Manus-managed MySQL/TiDB-compatible store in `src/db/mysql.js` through `DATABASE_URL`. Its InnoDB unique constraint and transactional `SELECT ... FOR UPDATE` claim hold across concurrent instances. The old SQLite store remains only as an isolated unit-test helper. The managed database schema is initialized automatically at startup; see `GO_LIVE_CHECKLIST.md` for provisioning and environment setup.

The scheduler calculates each user’s local date and wall-clock time from the current instant and their IANA timezone. It does not use a global UTC fire time, and the calculation follows timezone/DST transitions.

## Recommended external setup

For this simple HTTP wake-up, **cron-job.org is the recommended option** because it is purpose-built for recurring HTTP requests, supports custom headers, and can run at minute-level intervals. Create one job with the following values:

| Setting | Value |
|---|---|
| URL | `https://YOUR_PUBLISHED_MAILDM_URL/api/scheduler/tick` |
| Method | `POST` |
| Schedule | Every 5 minutes |
| Header | `X-Scheduler-Secret: YOUR_SCHEDULER_SECRET` |
| Body | Empty |

Generate a long random `SCHEDULER_SECRET`, save it only in Manus environment variables and the scheduler’s secret/header configuration, and never commit it. Rotate it by updating both places if it is exposed.

GitHub Actions is an alternative. The repository includes `.github/workflows/scheduler-ping.yml`; add `MAILDM_BASE_URL` and `SCHEDULER_SECRET` as repository secrets, then enable the workflow. GitHub scheduled workflows are best-effort and may be delayed under load, so the ten-minute window and database claim are required. Do not schedule the workflow exactly on the hour.

## Shared pipeline and failure handling

The protected tick calls the same `runSummaryForUser` pipeline used by `/summary-now`: Gmail read-only fetch, provider summarization, and Discord delivery. Google OAuth token refresh occurs through the Gmail client when an access token needs refreshing. Refresh/revocation failures mark the Gmail account `reauth_required` and trigger a `/reauthorize` notice. AI-provider or key failures mark the job failed and trigger an AI-key/provider notice. Discord DM failures mark the job failed as `DISCORD_DM_FAILURE` and pass the failure to the scheduler failure hook instead of being silently swallowed.

## Security and data handling

Discord requests are rejected unless the Ed25519 signature over `timestamp + raw request body` validates against `DISCORD_PUBLIC_KEY`. OAuth state is signed with `SESSION_SECRET`. Google access and refresh tokens, plus user-provided AI keys, are encrypted at rest with AES-256-GCM. The only Gmail scope requested is `gmail.readonly`; the adapter does not send, modify, or delete messages.

The summarizer has a dedicated system policy stating that email subjects, bodies, sender names, links, attachments, and quoted content are **untrusted data**, not instructions. It explicitly says never to follow instructions found in email content, impersonate another message role, call tools, change settings, reveal secrets, or alter the summarization task because an email requests it. Email fields are enclosed in an untrusted-data boundary, and `<`, `>`, and `&` are escaped so a malicious email cannot close the boundary with injected markup.

## Run locally

Copy `.env.example` to `.env`, fill the required credentials, install dependencies with `npm install`, and run `npm start`. Run `npm test` for behavior tests and `npm run check` for the repository check. Run `npm run register:commands` after setting the Discord application and bot variables.

## Google OAuth setup

Configure the Google Auth Platform Branding page with the deployed home page, privacy policy, and terms URLs. Register `GOOGLE_REDIRECT_URI` as an authorized redirect URI. The app requests `https://www.googleapis.com/auth/gmail.readonly`. See `GOOGLE_VERIFICATION.md` for the verification checklist and official references.
