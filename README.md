# MailDM

MailDM helps you stay on top of Gmail without constantly opening your inbox. It watches for new unread messages and sends a concise summary to you in a Discord direct message, so important emails are easier to notice and act on.

## What is MailDM and why it exists

People often do not check email often enough. Important messages can remain unread while meetings, requests, invoices, and account notices wait in the inbox. MailDM connects Gmail to Discord and summarizes what is new for you.

MailDM reads Gmail in read-only mode. It does not send, edit, or delete Gmail messages. You control which AI provider summarizes your mail by adding your own provider key through a private Discord message.

## Setup — required IDs, keys, and secrets

Copy `.env.example` to `.env` and fill in the values below. Never commit `.env`, API keys, OAuth secrets, bot tokens, database credentials, or encryption secrets.

| Variable | Required for | What it means and where to get it |
|---|---|---|
| `PORT` | Local/server startup | The HTTP port. `3000` is a sensible local value. |
| `DATABASE_URL` | Production startup | The MySQL/TiDB-compatible connection URL supplied by your hosting database service. |
| `SESSION_SECRET` | OAuth and encryption | A long random secret, at least 32 characters. MailDM uses it to sign OAuth state and encrypt stored credentials and Gmail tokens. |
| `GOOGLE_CLIENT_ID` | Gmail connection | The OAuth client ID from a Google Cloud project with the Gmail API enabled. |
| `GOOGLE_CLIENT_SECRET` | Gmail connection | The matching OAuth client secret from Google Cloud. Keep it private. |
| `GOOGLE_REDIRECT_URI` | Gmail connection | The exact callback URL registered in Google Cloud, such as `http://localhost:3000/auth/google/callback`. |
| `APP_BASE_URL` | OAuth callback | The public base URL where MailDM is running, such as `https://maildm.example.com`. |
| `DISCORD_APPLICATION_ID` | Discord commands and interactions | The Application ID from the Discord Developer Portal. |
| `DISCORD_PUBLIC_KEY` | Discord interaction security | The public key from the Discord Developer Portal. Discord uses it to sign interaction requests. |
| `DISCORD_BOT_TOKEN` | Discord delivery and command registration | The bot token from the Discord Developer Portal. Keep it private. |
| `SCHEDULER_SECRET` | Scheduled summaries | A separate long random secret sent by your external scheduler in the `X-Scheduler-Secret` header. |
| `SCHEDULER_DUE_WINDOW_MINUTES` | Scheduled summaries | How late a scheduled run may arrive and still count as due. The default is `10`. |
| `ADMIN_DIAGNOSTIC_SECRET` | Temporary maintenance diagnostics | A separate long random secret for the temporary processed-item diagnostic endpoints. Keep it private and do not share it in a URL or chat. |
| `OPENAI_API_KEY` | Optional provider fallback | An optional server-side OpenAI key. Most users should add their own key privately with `/set-ai-key` instead. |
| `ANTHROPIC_API_KEY` | Optional provider fallback | An optional server-side Anthropic key. Most users should add their own key privately with `/set-ai-key` instead. |

### Discord command registration

Leave `DISCORD_REGISTER_GUILD_ID` unset for normal operation. When it is unset, `npm run register:commands` registers commands globally, which allows DM-only commands such as `/set-ai-key`, `/models`, and `/set-model` to appear correctly in Discord direct messages.

The registration script still recognizes `DISCORD_REGISTER_GUILD_ID` as an optional local-testing override. Guild registration can be useful while developing because changes appear faster, but it is not the normal production configuration. Do not enter an AI key in a public guild channel. Discord displays command parameters to people in that context, while MailDM intentionally blocks credential commands outside a direct message.

## Commands

| Command | What it does | Where it works |
|---|---|---|
| `/sample` | Shows an example summary. | Anywhere |
| `/connect` | Starts the Gmail connection flow. | Anywhere |
| `/accounts` | Lists your connected Gmail accounts. | Anywhere |
| `/disconnect` | Disconnects and purges one Gmail account. You can optionally provide its email address. | Anywhere |
| `/settings` | Shows your MailDM settings. | Anywhere |
| `/set-time` | Sets your daily summary time, such as `09:00`, with an optional IANA timezone such as `America/New_York`. | Anywhere |
| `/set-ai-provider` | Sets the legacy default provider preference: OpenAI or Anthropic. | Anywhere |
| `/set-ai-key` | Adds an OpenAI, Anthropic, OpenRouter, or custom OpenAI-compatible provider key. | **DM only** |
| `/models` | Browses available models for your stored credentials. | **DM only** |
| `/set-model` | Selects a model using a short-lived selection token from `/models`. | **DM only** |
| `/remove-api-key` | Removes a stored AI credential using its selection token. | **DM only** |
| `/summary-now` | Fetches and summarizes recent new Gmail messages immediately. | Anywhere |
| `/delete-my-data` | Deletes all MailDM data belonging to your Discord user. | Anywhere |
| `/reauthorize` | Starts the Gmail authorization flow again when access needs attention. | Anywhere |

Credential and model commands are DM-only because API keys and credential choices should not be exposed in a server channel. MailDM replies privately to commands using Discord's ephemeral response mechanism where applicable.

## Usage

A typical first-time setup looks like this:

1. Start MailDM and register the Discord commands with `npm run register:commands`.
2. In Discord, use `/connect` and complete the Google authorization flow.
3. In a Discord direct message with the bot, use `/set-ai-key` and choose your provider. Never paste an API key into a public server channel.
4. In the same direct message, use `/models` to browse the models available to that credential.
5. Use `/set-model` with the selection token from `/models`.
6. Use `/summary-now` to request a summary immediately, or use `/set-time` to configure the daily schedule.

After a summary is delivered, you can use the feedback buttons on the final Discord message to mark it helpful or not helpful.

## Run locally

Install dependencies and start the application:

```bash
cp .env.example .env
npm install
npm start
```

Run the automated checks with:

```bash
npm test
npm run check
```

The production server uses the MySQL/TiDB-compatible store through `DATABASE_URL`. The SQLite store is retained as a unit-test helper.

## Need the deeper technical details?

Read [TECHNICAL.md](TECHNICAL.md) for the architecture, provider integration, scheduler contract, failure handling, security model, and Google OAuth setup.

## References

[1]: .env.example "MailDM environment variable template"
[2]: src/discord/commands.js "MailDM Discord command definitions"
[3]: src/discord/register-commands.js "MailDM Discord command registration script"
[4]: src/oauth/google.js "MailDM Google OAuth implementation"
[5]: src/security/index.js "MailDM security helpers"
