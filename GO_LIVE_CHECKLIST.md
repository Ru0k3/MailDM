# MailDM go-live checklist

This document is the authoritative setup sequence for the current repository. It matches the code in `main` after the scheduler and retry changes. Do not skip the database prerequisite: the current implementation uses SQLite, and a file-local SQLite database is not a safe shared store for a multi-instance Autoscale deployment.

## 1. Current architecture decision

Manus Autoscale can scale the Express process to zero while idle. MailDM therefore uses an external wake-up request rather than an in-process timer:

```http
POST https://YOUR_PUBLISHED_MAILDM_URL/api/scheduler/tick
X-Scheduler-Secret: YOUR_SCHEDULER_SECRET
Content-Length: 0
```

The route rejects missing or incorrect secrets with HTTP `401` before constructing or invoking scheduler work. It is not part of the Discord interaction endpoint and is not documented on public user pages.

The scheduler uses a default ten-minute due window and should be called every five minutes. It converts the current instant into each user’s IANA timezone, compares the configured local `HH:MM`, and claims `(user_id, local_date, delivery_kind='scheduled')` using a database uniqueness constraint.

## 2. Retry decision and exact semantics

A bounded retry is implemented. The first scheduled claim has `attempt_count=1`. If the pipeline fails before delivery is attempted, the row is `failed` with `delivery_attempted=0`; one later tick inside the ten-minute due window may atomically claim it again, changing it to `attempt_count=2` and `processing`. The retry is not available for reauthorization failures, no-account failures, or permanent AI-key authentication failures (HTTP 401/403). Transient AI failures such as rate limits or provider/server errors remain eligible for the one bounded retry.

Immediately before calling Discord DM delivery, the scheduler sets `delivery_attempted=1`. Any exception during or after that delivery call is permanently non-retryable for that local date, because the request may have reached Discord even if the response was lost. This avoids duplicate briefs at the cost of not retrying an uncertain delivery. The behavior is tested in `tests/mvp.test.js`.

## 3. Environment variables

Set these in the Manus project’s server environment. Never commit `.env` or any real secret.

| Variable | Required? | Value source | Current code usage |
|---|---:|---|---|
| `PORT` | Optional | Manus runtime or self-chosen; default `3000` | Express listen port |
| `DATABASE_PATH` | Required for deployment | Self-chosen persistent path, for example `./data/maildm.sqlite` | SQLite database path; see the Autoscale database gate below |
| `SESSION_SECRET` | Required | Self-generated cryptographically random secret, at least 32 characters | OAuth state signing and AES-256-GCM token/key encryption |
| `SCHEDULER_SECRET` | Required | Self-generated separate cryptographically random secret | `X-Scheduler-Secret` authentication for the scheduler endpoint |
| `SCHEDULER_DUE_WINDOW_MINUTES` | Optional | Self-chosen integer; use `10` | Widened due window for cold starts and delayed pings |
| `APP_BASE_URL` | Required | Final published HTTPS URL from Manus | OAuth link returned by `/connect` and OAuth callback redirect |
| `GOOGLE_CLIENT_ID` | Required | Google Cloud Console OAuth client | Google OAuth client configuration |
| `GOOGLE_CLIENT_SECRET` | Required | Google Cloud Console OAuth client | Google OAuth token exchange |
| `GOOGLE_REDIRECT_URI` | Required | Construct from final URL: `https://YOUR_PUBLISHED_MAILDM_URL/auth/google/callback` | Google OAuth authorized redirect URI and client configuration |
| `DISCORD_APPLICATION_ID` | Required for command registration | Discord Developer Portal → General Information → Application ID | Slash-command registration script |
| `DISCORD_PUBLIC_KEY` | Required at runtime | Discord Developer Portal → General Information → Public Key | Ed25519 verification of Discord interactions |
| `DISCORD_BOT_TOKEN` | Required at runtime | Discord Developer Portal → Bot → Token | Discord DM delivery and command registration |
| `DISCORD_REGISTER_GUILD_ID` | Optional | Discord server ID for development registration | If set, registers commands to one guild; if blank, registers globally |
| `OPENAI_API_KEY` | Optional default provider key | OpenAI account/API-key console | Used when a user has not set a personal encrypted key and provider is OpenAI |
| `ANTHROPIC_API_KEY` | Optional default provider key | Anthropic console | Used when a user has not set a personal encrypted key and provider is Anthropic |

At least one AI provider key must be available unless every user will set a personal key through `/set-ai-key`. The code supports OpenAI and Anthropic; the selected provider/model is stored per user.

There is no current `SCHEDULER_ENABLED` variable. The old in-process timer was removed; do not set that variable expecting it to control anything.

## 4. Database gate before Autoscale

The current code uses `better-sqlite3` and `DATABASE_PATH`. A single file-local SQLite database is not sufficient if Manus Autoscale creates more than one instance or if the filesystem is ephemeral. Before production go-live on Autoscale, choose one of these paths:

1. Use a Manus-provided durable/shared database and replace the SQLite store with the corresponding adapter, preserving the unique scheduled-claim constraint and transactional updates; or
2. Use Manus Reserved hosting with a persistent volume and one process; or
3. Deploy the app to another host with a durable volume and single process.

The protected callback solves the sleeping-process problem, but it does **not** by itself make a local SQLite file shared or durable across multiple Autoscale instances. Do not mark production scheduling safe until this database gate is resolved and tested against the actual published hosting configuration.

## 5. Exact order of operations

### Step 1: Prepare secrets and source

Clone commit [`856f541fd67df8370570609e53da914784b254b8`](https://github.com/Ru0k3/MailDM/commit/856f541fd67df8370570609e53da914784b254b8) or a later commit. Generate separate random values for `SESSION_SECRET` and `SCHEDULER_SECRET`; do not reuse them. Keep the scheduler secret separate from Discord, Google, and AI credentials.

### Step 2: Publish once to obtain the URL

Publish the current app in Manus with a temporary or initial environment configuration sufficient for the service to start. Copy the final published HTTPS URL. Set `APP_BASE_URL` to that URL and set `GOOGLE_REDIRECT_URI` to `${APP_BASE_URL}/auth/google/callback`.

If the published URL changes later, update both values and the Google authorized redirect URI.

### Step 3: Configure Manus environment variables

Enter the full variable list from Section 3 in the Manus project’s server environment. Set `DATABASE_PATH` only after confirming the storage/database gate in Section 4. Redeploy after changing server variables.

Verify these public routes after redeployment: `/health`, `/`, `/privacy`, `/terms`, `/gmail-readiness`, `/sample`, `/settings`, and `/summary-now`.

### Step 4: Configure Discord

In Discord Developer Portal, open the application identified by `DISCORD_APPLICATION_ID`. Copy the Public Key into `DISCORD_PUBLIC_KEY` and the Bot Token into `DISCORD_BOT_TOKEN`. Set the Interactions Endpoint URL to:

```text
https://YOUR_PUBLISHED_MAILDM_URL/interactions
```

The endpoint must validate Discord’s signature and respond successfully to Discord’s verification request. Then run `npm run register:commands` with `DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN`, and optionally `DISCORD_REGISTER_GUILD_ID` set. For initial testing, use a guild ID so commands register quickly; register globally only after the guild test works.

### Step 5: Configure Google Cloud

In Google Cloud Console for project `maildm-506818`, configure the OAuth client’s authorized redirect URI as:

```text
https://YOUR_PUBLISHED_MAILDM_URL/auth/google/callback
```

Configure Branding with the real application home page, `/privacy`, and `/terms` URLs. Add the authorized domain for the domain hosting those URLs and the callback. The current app requests only `https://www.googleapis.com/auth/gmail.readonly`.

Keep the OAuth app in Testing while validating. Add the Gmail test account as a test user. The current Google project was observed in Testing with Branding incomplete; do not claim verification complete until Google Cloud shows the saved branding and any required review status.

### Step 6: Configure the external scheduler

Recommended option: cron-job.org. Create a job with these exact settings:

| Field | Value |
|---|---|
| URL | `https://YOUR_PUBLISHED_MAILDM_URL/api/scheduler/tick` |
| Method | `POST` |
| Interval | Every 5 minutes |
| Request header | `X-Scheduler-Secret: <the exact SCHEDULER_SECRET value>` |
| Request body | Empty |
| Content type | Not required; if the service insists, use `application/json` with an empty body |

Run one manual request first:

```bash
curl --fail-with-body --silent --show-error \
  --request POST \
  --header "X-Scheduler-Secret: $SCHEDULER_SECRET" \
  --header "Content-Length: 0" \
  "https://YOUR_PUBLISHED_MAILDM_URL/api/scheduler/tick"
```

The response should be JSON with `checked`, `claimed`, `completed`, and `failed` counts. Configure the external scheduler only after this request succeeds.

Alternative: enable `.github/workflows/scheduler-ping.yml` and create GitHub repository secrets `MAILDM_BASE_URL` and `SCHEDULER_SECRET`. The workflow calls the same URL every five minutes with retries. GitHub Actions schedules are best-effort and can be delayed, so keep the ten-minute due window. Do not schedule at exactly the top of the hour if using a custom workflow.

## 6. Manual go-live test sequence

Run these in order and record evidence.

1. **Health and public pages.** Confirm `/health` returns `{ "ok": true }`, and confirm the home, privacy, terms, Gmail-readiness, sample, settings, and summary-now pages load over HTTPS.

2. **Scheduler authentication.** Call `POST /api/scheduler/tick` with no header and with a wrong header. Confirm both return `401`. Check the application logs and database to confirm no user was claimed and no delivery pipeline ran.

3. **Scheduler execution.** Create one test Discord user, connect a test Gmail account, set `/set-time` to a time a few minutes in the future with the correct IANA timezone, and configure an AI provider/key. Trigger the endpoint during the due window. Confirm one DM arrives and the response reports one completed job.

4. **Retry behavior.** Simulate or observe one transient pre-delivery failure. Trigger again within the ten-minute window. Confirm the same `summary_history` row reaches `complete` with `attempt_count=2` and exactly one Discord brief is delivered.

5. **Post-delivery safety.** Simulate a Discord delivery error after the delivery boundary. Trigger again inside the window. Confirm the row remains `failed` with `delivery_attempted=1`, no second delivery is attempted, and the failure hook/log records `DISCORD_DM_FAILURE`.

6. **Timezone and DST.** Test at least one account in `America/New_York` or another DST-observing zone around a known transition. Confirm the brief is due according to the user’s local wall clock, not a fixed UTC time.

7. **Gmail read-only verification.** Inspect Google Cloud OAuth scopes and confirm only `gmail.readonly` is requested. Verify that MailDM does not send, modify, label, archive, or delete a Gmail message. Use a disposable test email account if possible.

8. **Reauthorization failure.** Revoke the test account’s Google authorization or force an invalid refresh token. Trigger the scheduler. Confirm the Gmail account is marked `reauth_required`, the job is failed, and the user receives a DM directing them to `/reauthorize`.

9. **AI-key failure.** Configure an invalid or deliberately rate-limited provider key. Trigger the scheduler. Confirm the job is failed and the user receives an AI-provider/key notice rather than a silent skip.

10. **Account purge.** Run `/disconnect` for one connected account. Confirm the account row and encrypted tokens are gone, while unrelated data remains if another account exists. Then run `/delete-my-data` and confirm the user, settings, Gmail accounts, feedback, and `summary_history` rows are all deleted.

11. **Secret hygiene.** Search application logs and repository files for the values of `SESSION_SECRET`, `SCHEDULER_SECRET`, `GOOGLE_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, AI keys, OAuth tokens, and refresh tokens. None should appear. Confirm `/settings` reports only whether an AI key is configured and never prints the key.

12. **External scheduler observation.** Leave the external job enabled through at least two expected ticks. Confirm the published service can cold-start and still process a due user. Confirm a repeated tick on the same local date does not create a second `summary_history` row.

## 7. Google verification readiness

Before submitting or publishing the OAuth app, complete the following: a real publicly reachable HTTPS home page, a real privacy-policy page, a terms-of-service page if used, a verified/authorized domain for those URLs and the callback, accurate app name and support contact, Gmail-only scope justification, and a screen recording or reviewer instructions showing the OAuth flow and read-only behavior if Google requests them.

A custom domain is **not automatically required by the application code** if the Manus published HTTPS domain is accepted and can be added as the authorized domain. A custom domain is useful for branding and stable ownership, but it should not be treated as a code prerequisite. The real requirement is that the URLs are public, accurate, owned/controlled by the operator, and match the Google Cloud configuration.

A logo is optional for initial Testing but should be added if desired before production branding. Google verification is not complete merely because the app is in Testing; it is a separate Google Cloud status/configuration step.

## 8. Definition of complete

MailDM is ready for production scheduling only when the database gate is resolved for the actual Manus hosting mode, the published URL is configured in Manus/Discord/Google consistently, the protected external scheduler has been observed making successful calls, the manual test sequence passes, and this repository state is committed and pushed. Record the exact commit hash in the deployment notes; never report a sandbox-only result as complete.
