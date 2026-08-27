# MailDM

MailDM delivers private, AI-generated daily Gmail briefs through Discord direct messages. The initial release supports multiple users and multiple read-only Gmail accounts per user, bounded in-memory message processing, user-owned AI provider keys, provider-specific recommended models, and timezone-aware daily delivery.

## What MailDM does

MailDM accepts verified Discord HTTP Interactions. A user privately connects Gmail through Google OAuth, selects an AI provider/model, securely submits their provider API key through a Discord modal, and sets a local delivery time. Scheduled callbacks fetch Gmail messages matching `is:unread`, sanitize and normalize them in memory, create a brief, and send it as a Discord DM.

The service only requests Gmail `gmail.readonly` access. It does not send email, delete email, archive email, label email, or mark email as read. If no messages qualify, it sends the exact message: `No important unread mail today`.

## Deployment configuration

Set protected server environment variables through the project settings; never commit them to GitHub or place them in client code.

| Variable | Purpose |
| --- | --- |
| `DISCORD_APPLICATION_ID` | Discord application ID for slash-command registration. |
| `DISCORD_PUBLIC_KEY` | Discord application public key used to verify incoming Interaction signatures. |
| `DISCORD_BOT_TOKEN` | Bot token used only for slash-command registration and direct-message delivery. |
| `GOOGLE_CLIENT_ID` | Google OAuth web client ID. |
| `GOOGLE_CLIENT_SECRET` | Google OAuth web client secret. |
| `GOOGLE_REDIRECT_URI` | Exact HTTPS callback URL: `https://<published-domain>/api/auth/google/callback`. |
| `CREDENTIAL_ENCRYPTION_KEY` | Base64-encoded 32-byte AES-256-GCM encryption key. |

## Discord configuration

In the Discord Developer Portal, set the **Interactions Endpoint URL** to:

```text
https://<published-domain>/api/discord/interactions
```

Install the app in the private test server with the `applications.commands` and `bot` scopes. MailDM does not need Message Content Intent for its slash-command workflow. The bot must be permitted to send direct messages to users who opt in through the private setup flow.

## Google configuration

Create a Google Cloud project, enable Gmail API, configure an External OAuth consent screen in testing mode, add the intended Gmail test accounts, and request the `https://www.googleapis.com/auth/gmail.readonly` scope. Create a Web OAuth client only after the application is published and add the exact value of `GOOGLE_REDIRECT_URI` to its authorized redirect URIs.

## User commands

| Command | Private behavior |
| --- | --- |
| `/start` | Explains onboarding. |
| `/connect gmail [label]` | Creates a 15-minute Google authorization link for one Gmail account. |
| `/accounts` | Lists connected Gmail accounts and account IDs. |
| `/disconnect <account_id>` | Revokes local access and attempts Google token revocation. |
| `/reauthorize <account_id>` | Creates a new Google link if MailDM marks an account as requiring reauthorization. |
| `/set-ai-provider` | Selects OpenAI, Anthropic, or NVIDIA. |
| `/set-model` | Selects a fixed recommended model for the active provider. |
| `/set-ai-key` | Opens a Discord DM-only modal, validates and encrypts the user’s key. |
| `/set-time` | Creates or updates a managed daily scheduled callback in the user’s IANA timezone. |

## Development checks

```text
pnpm check
pnpm test
```

Read [ARCHITECTURE.md](./ARCHITECTURE.md) for security and data-retention details, and [SOURCES.md](./SOURCES.md) for provider references.
