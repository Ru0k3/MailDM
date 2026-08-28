# MailDM setup guide reconciled to the provided Manus screenshots

This guide is based on the two screenshots and the committed MailDM source. It supersedes any earlier checklist wording that conflicts with the current source.

## 1. What Screenshot 1 means

Screenshot 1 is the managed TiDB Cloud MySQL-compatible database provisioned for the Manus project. The current production entrypoint uses `src/db/mysql.js`, which reads `DATABASE_URL`.

Use the **Connection URL field exactly as shown**, including its username, password, host, port, and database name. Do not manually assemble a new URL from the separate fields.

In the screenshot, the URL begins with the pattern:

```text
mysql://USERNAME:PASSWORD@gateway04.us-east-1.prod.aws.tidbcloud.com:4000/...
```

The password is masked in the display, but the copy icon beside **Connection URL** copies the complete value. Click that copy icon and paste the complete value into the Manus secret named `DATABASE_URL`. Treat it as a password because it contains database credentials.

The separate Server Host, Port, Username, and Password fields are useful for a standalone MySQL client, but they are not what the MailDM application needs when the Connection URL is available.

## 2. What Screenshot 2 means

Screenshot 2 shows these existing entries:

| Existing entry | What to do |
|---|---|
| `DISCORD_PUBLIC_KEY` | Keep; current Discord signature verifier reads it |
| `DISCORD_BOT_TOKEN` | Keep; current Discord delivery code reads it |
| `GOOGLE_CLIENT_ID` | Keep; current Google OAuth code reads it |
| `GOOGLE_CLIENT_SECRET` | Keep; current Google OAuth code reads it |
| `CREDENTIAL_ENCRYPTION_KEY` | Not read by the current MailDM source; it has no effect on this app |
| `VITE_FRONTEND_FORGE_API_URL` | Manus-generated frontend/internal variable; not read by this Express app; leave it alone |
| `DISCORD_APPLICATION_ID` | Keep; command registration reads it |

The current committed source reads **`SESSION_SECRET`**, not `CREDENTIAL_ENCRYPTION_KEY`, in three security roles: OAuth state signing, Google token encryption, and per-user AI-key encryption. You must add `SESSION_SECRET` even though a similarly named encryption variable already exists. Do not assume `CREDENTIAL_ENCRYPTION_KEY` is a substitute.

The source also reads `DATABASE_URL`, `APP_BASE_URL`, `GOOGLE_REDIRECT_URI`, `SCHEDULER_SECRET`, `SCHEDULER_DUE_WINDOW_MINUTES`, and provider keys. The production server does not read `DATABASE_PATH`; that name occurs only in the SQLite unit-test helper.

## 3. Secrets and configuration still to add

Do not re-add the seven entries already visible in Screenshot 2. Add the following entries.

| Exact name | Required? | Value source | How to create or obtain it |
|---|---:|---|---|
| `DATABASE_URL` | Yes | Screenshot 1 | Click the copy icon next to **Connection URL** and paste the complete `mysql://...` value |
| `SESSION_SECRET` | Yes | Self-generated | Generate a long random value, at least 32 characters; this is the secret the current code actually uses for OAuth state and encryption |
| `SCHEDULER_SECRET` | Yes | Self-generated | Generate a different long random value; cron-job.org sends it in `X-Scheduler-Secret` |
| `APP_BASE_URL` | Yes after first Publish | Manus | Publish once, copy the final HTTPS URL, and set it exactly, without a trailing slash if possible |
| `GOOGLE_REDIRECT_URI` | Yes after first Publish | Derived from Manus URL | Set to `https://YOUR_PUBLISHED_URL/auth/google/callback` |
| `SCHEDULER_DUE_WINDOW_MINUTES` | Recommended | Self-chosen | Set `10`; this is configuration, not a secret, but it can be stored in the same configuration area |
| `OPENAI_API_KEY` | Optional default | OpenAI API-key console | Add if users should be able to summarize without entering a personal key; the default provider is OpenAI |
| `ANTHROPIC_API_KEY` | Optional default | Anthropic console | Add if Anthropic should be available as a server default |
| `DISCORD_REGISTER_GUILD_ID` | Optional | Discord server | Add the test server ID for fast guild command registration; omit it for global registration |
| `PORT` | Optional | Manus/default | Leave unset unless Manus requires it; the code defaults to `3000` |

For a first working test, add `OPENAI_API_KEY` unless you plan to use `/set-ai-key` before every summary. Do not add `DATABASE_PATH`, `SCHEDULER_ENABLED`, or another encryption variable for this production code.

### Generate the two self-generated secrets

Run this locally, not in a chat message or committed file:

```bash
python3 -c "import secrets; print('SESSION_SECRET=' + secrets.token_urlsafe(48)); print('SCHEDULER_SECRET=' + secrets.token_urlsafe(48))"
```

Copy each output value into its matching Manus entry. Never put either value into GitHub source, screenshots, cron-job.org notes, or Discord/Google settings.

## 4. Exact order: Manus Publish first, then Discord and Google

### Step 1 — Add the database and pre-publish values

1. In Manus, stay on **Settings → Secrets**.
2. Click **Add Secret**.
3. Add `DATABASE_URL`. In the Manage Database panel, click the copy icon beside **Connection URL**, then paste the complete value. Do not use the masked display text.
4. Add `SESSION_SECRET` using the self-generated value.
5. Add `SCHEDULER_SECRET` using a different self-generated value.
6. Add `SCHEDULER_DUE_WINDOW_MINUTES` with value `10`.
7. Add `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` if they will be server defaults.
8. Leave the existing `CREDENTIAL_ENCRYPTION_KEY` and `VITE_FRONTEND_FORGE_API_URL` entries unchanged for now; MailDM does not read either one.

### Step 2 — Publish once to obtain the real URL

1. Click **Publish** in the upper-right Manus toolbar.
2. Wait until Manus reports the deployment is live.
3. Copy the published HTTPS URL from the published-site result. Call this `APP_BASE_URL`.
4. Return to **Settings → Secrets**, click **Add Secret**, and add `APP_BASE_URL` with that exact URL.
5. Add `GOOGLE_REDIRECT_URI` with this exact derived value:

```text
APP_BASE_URL + /auth/google/callback
```

For example, if the published URL is `https://maildm-abc.manus.space`, the redirect URI is `https://maildm-abc.manus.space/auth/google/callback`.

6. Publish again so the running server receives both new values. This second publish is necessary; setting a secret alone does not update an already-running process until Manus redeploys it.

### Step 3 — Configure Discord’s application endpoint

1. Open [Discord Developer Portal](https://discord.com/developers/applications).
2. Click the MailDM application whose ID matches `DISCORD_APPLICATION_ID`.
3. In the left menu, click **General Information**.
4. Confirm that the **Public Key** shown there matches the Manus `DISCORD_PUBLIC_KEY` value. Do not paste the Bot Token into this field.
5. In the left menu, click **Interactions** or return to **General Information** if Discord displays the endpoint field there.
6. Find **Interactions Endpoint URL**.
7. Paste:

```text
https://YOUR_PUBLISHED_MAILDM_URL/interactions
```

8. Click **Save Changes**. Discord sends a verification request; the MailDM endpoint must answer it successfully. If Discord rejects it, check that `DISCORD_PUBLIC_KEY` is copied exactly and that the latest Manus publish is live.
9. In Discord Developer Portal, open **Bot** and confirm the bot is created and the token in Manus is the current token. If you regenerate the token, replace `DISCORD_BOT_TOKEN` in Manus and publish again.
10. Install/invite the bot to your test server with the `bot` and `applications.commands` scopes. Use a test server where you can send yourself a DM.

### Step 4 — Register the slash commands

The repository’s registration script reads `DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN`, and optional `DISCORD_REGISTER_GUILD_ID`. Run it from a local clone of the repository after putting those values in a local `.env` file that is not committed:

```bash
npm ci
npm run register:commands
```

For fast testing, set `DISCORD_REGISTER_GUILD_ID` to the ID of your test Discord server before running the command. In Discord, enable **Developer Mode** under **User Settings → Advanced**, then right-click the test server and choose **Copy Server ID**. After the guild commands work, you may remove `DISCORD_REGISTER_GUILD_ID` and run the script again to register globally; global propagation can take longer.

### Step 5 — Configure Google OAuth

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. At the top project selector, select the MailDM project, `maildm-506818`.
3. In the left navigation, click **APIs & Services → Library**.
4. Search for **Gmail API**, open it, and click **Enable** if it is not already enabled.
5. Go to **APIs & Services → Credentials**.
6. Under **OAuth 2.0 Client IDs**, click the MailDM web client whose client ID matches `GOOGLE_CLIENT_ID`.
7. Under **Authorized redirect URIs**, click **Add URI**.
8. Paste exactly:

```text
https://YOUR_PUBLISHED_MAILDM_URL/auth/google/callback
```

9. Click **Save**.
10. Go to **Google Auth Platform → Branding** and enter the real published MailDM home page URL, privacy-policy URL, and terms URL if used. Save each section.
11. Go to **Google Auth Platform → Audience**.
12. Keep the app in **Testing** while validating. Under **Test users**, click **Add users**, enter each Gmail address that will test MailDM, and save.
13. Do not request any additional Gmail scope. The current code requests only `https://www.googleapis.com/auth/gmail.readonly`.

### Step 6 — Configure cron-job.org

1. Create an account at [cron-job.org](https://cron-job.org/) and open the dashboard.
2. Click **Create cronjob**.
3. Give it a name such as `MailDM scheduler`.
4. Set the URL to:

```text
https://YOUR_PUBLISHED_MAILDM_URL/api/scheduler/tick
```

5. Choose HTTP method **POST**.
6. Set the schedule to **every 5 minutes**.
7. Add the request header:

```text
X-Scheduler-Secret: THE_EXACT_SCHEDULER_SECRET_VALUE
```

8. Leave the request body empty. If cron-job.org requires a content type, use `application/json` with an empty body.
9. Save/activate the job.
10. Use the job’s **Run now** action once. A successful response is JSON containing `checked`, `claimed`, `completed`, and `failed` counts. A missing or wrong secret must return `401` and do no work.

Never place the scheduler secret in the URL. If it is exposed, generate a new value, update Manus, republish, and update cron-job.org.

## 5. Manual test sequence after wiring

1. Open the published `/health` URL and confirm it returns an OK response.
2. Open `/privacy`, `/terms`, and `/gmail-readiness` and confirm they are publicly reachable over HTTPS.
3. In Discord, run `/connect` and open the returned Google authorization link.
4. Sign in with a Gmail address added as a Google test user. Approve only the Gmail read-only access requested by MailDM.
5. Confirm the OAuth callback returns to the published MailDM site and run `/accounts` to confirm the address is connected.
6. Run `/set-time` with a time a few minutes ahead and the correct IANA timezone, for example `09:00` and `America/New_York`. Run `/settings` and confirm both values.
7. Run `/summary-now`. Confirm a summary arrives and the response includes Helpful/Not helpful controls.
8. Click both feedback controls in separate test runs and confirm no secrets or tokens appear in the response or logs.
9. Trigger cron-job.org while the user is inside the ten-minute due window. Confirm one scheduled brief arrives.
10. Trigger the scheduler again. Confirm no second brief arrives for the same user/local date.
11. Call the scheduler endpoint once without `X-Scheduler-Secret` and once with a wrong value. Confirm both return `401` and no summary-history claim is created.
12. Test the Gmail read-only guarantee by confirming the Google consent screen shows only Gmail read access and that MailDM has not sent, changed, labeled, archived, or deleted a Gmail message.
13. Test `/disconnect` and confirm the connected account and stored tokens disappear. If a second account remains, confirm unrelated account data remains.
14. Test `/delete-my-data` and confirm the user’s settings, Gmail accounts/tokens, feedback, and summary-history records are gone.
15. Search logs for `SESSION_SECRET`, `SCHEDULER_SECRET`, `DATABASE_URL`, Google client secret, Discord bot token, AI keys, access tokens, and refresh tokens. None may appear.

## 6. Google verification: required versus not yet required

At the current Testing stage, Google verification is not yet required for listed test users. Before publishing the OAuth app to production or submitting a verification request, complete the real public home page, privacy-policy page, and any terms page; configure the authorized domain; ensure the redirect URI exactly matches the published URL; provide an accurate Gmail-readonly scope justification; and prepare reviewer instructions or a recording of the OAuth/read-only flow if Google requests it.

A custom domain is not a code prerequisite if the Manus published HTTPS domain is accepted by Google and can be configured as the authorized domain. A custom domain is useful for stable branding, but it is not automatically required at this stage. A logo is optional for initial Testing, though it may be appropriate before production publication.

## 7. Final production gate

Do not publish the production configuration until `DATABASE_URL` is set from Screenshot 1’s complete Connection URL, the app has been republished with `APP_BASE_URL` and `GOOGLE_REDIRECT_URI`, the Discord endpoint has been verified, commands have been registered, Google test-user OAuth succeeds, the cron-job.org request succeeds, and the manual secret-hygiene and deletion tests pass.

The committed source reads `SESSION_SECRET`, not `CREDENTIAL_ENCRYPTION_KEY`; `VITE_FRONTEND_FORGE_API_URL` is not used by this Express app; and the production database is the managed MySQL/TiDB service through `DATABASE_URL`.
