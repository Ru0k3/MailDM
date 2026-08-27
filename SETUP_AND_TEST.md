# MailDM Secure Setup and Test Guide

## Before you begin

MailDM is ready for **named-user Gmail testing**. Do not add public users until you have a stable custom domain and complete Google’s production OAuth verification process described in [GOOGLE_VERIFICATION.md](./GOOGLE_VERIFICATION.md).

Never paste a bot token, Google client secret, AI key, database password, or encryption key into Discord, GitHub, source code, or chat. Configure secrets only in the project’s protected environment-variable settings.

## 1. Publish the project

Use the project interface’s **Publish** button to publish the checkpoint. Once the project has a stable published HTTPS domain, copy it. The examples below use `https://YOUR-MAILDM-DOMAIN`.

## 2. Configure protected environment variables

| Variable | Value to provide |
| --- | --- |
| `DISCORD_APPLICATION_ID` | Application ID from Discord Developer Portal → General Information. |
| `DISCORD_PUBLIC_KEY` | Public Key from Discord Developer Portal → General Information. |
| `DISCORD_BOT_TOKEN` | Token from Discord Developer Portal → Bot. Reset it if it was ever exposed. |
| `GOOGLE_CLIENT_ID` | OAuth Web Client ID from Google Cloud → Google Auth Platform → Clients. |
| `GOOGLE_CLIENT_SECRET` | Matching OAuth Web Client secret. |
| `GOOGLE_REDIRECT_URI` | `https://YOUR-MAILDM-DOMAIN/api/auth/google/callback` exactly. |
| `CREDENTIAL_ENCRYPTION_KEY` | A unique base64-encoded 32-byte server-side key. Do not change it after credentials are stored, unless you plan a controlled credential re-encryption migration. |

The status page should report **Gmail OAuth: Ready** only after the Google variables are present.

## 3. Configure Discord

1. Open the MailDM application in the Discord Developer Portal.
2. In **General Information**, copy the Application ID and Public Key into the protected project variables listed above.
3. In **Bot**, copy the bot token into the protected `DISCORD_BOT_TOKEN` variable. Do not share it elsewhere.
4. In **Installation**, retain the `bot` and `applications.commands` scopes, then ensure the bot is installed in the private MailDM test server.
5. Set the **Interactions Endpoint URL** to:

   ```text
   https://YOUR-MAILDM-DOMAIN/api/discord/interactions
   ```

6. Save the endpoint. Discord sends a validation ping; MailDM responds only after verifying the request signature.
7. After secrets are set and the project is redeployed, MailDM registers its slash commands with Discord automatically.

## 4. Configure Google Cloud for testing

1. Create or select a Google Cloud project for **testing**, distinct from any later production project.
2. Enable the Gmail API.
3. In Google Auth Platform, configure an **External** consent screen in **Testing** status.
4. Add only your chosen Gmail addresses as test users.
5. Declare the single Gmail scope:

   ```text
   https://www.googleapis.com/auth/gmail.readonly
   ```

6. Create a **Web application** OAuth client.
7. Add this exact Authorized redirect URI:

   ```text
   https://YOUR-MAILDM-DOMAIN/api/auth/google/callback
   ```

8. Copy the client ID and client secret to the protected project variables. Do not put them in the client application.

Testing users will see Google’s unverified-app warning while the project remains in testing status. This is expected for the personal proof of concept.

## 5. Test the Discord user journey

Open a **direct message with MailDM**. Use the following sequence. The commands that handle account configuration and keys reject server/guild use and instruct the user to continue in DM.

| Step | Command | Expected result |
| --- | --- | --- |
| See the value first | `/sample` | Returns an illustrative brief without Gmail access or an AI key. |
| Begin setup | `/start` | Lists the private onboarding sequence. |
| Connect Gmail | `/connect provider:gmail label:Work` | Returns a 15-minute Google authorization link. Complete the consent flow in a normal browser. |
| Confirm linking | `/accounts` | Lists `Work`, its Gmail address, and `connected` status. Repeat `/connect` for another account and label. |
| Select provider | `/set-ai-provider provider:openai` | Selects a fixed recommended default model. Anthropic and NVIDIA are also available. |
| Select model | `/set-model model:gpt-4o-mini` | Stores a model only when it matches the selected provider’s recommended list. |
| Add key privately | `/set-ai-key` | Opens a Discord modal. Enter the provider key; MailDM performs a minimal validation call and persists it only if validation succeeds. |
| Configure daily timing | `/set-time time:08:00 timezone:Asia/Kolkata` | Stores the user-local schedule and creates/updates one managed callback. |
| Inspect or update | `/settings` | Shows Gmail-account count, active provider/model, and schedule. Provide provider/model or time/timezone options to update settings. |
| Generate a real brief | `/summary-now` | Runs the same read-only Gmail digest flow and delivers it by Discord DM. If nothing qualifies, the DM says exactly `No important unread mail today`. |

Each delivered brief includes **Helpful** and **Not helpful** controls. Choosing either writes only the feedback value to the associated delivery record.

## 6. Verify safety controls

| Control | How to verify |
| --- | --- |
| Read-only Gmail | Connect an account, run `/summary-now`, then confirm Gmail messages remain unread and unchanged. |
| Multiple accounts | Link two Gmail accounts with separate labels and confirm the resulting brief shows its source label for each summarized item. |
| Failed AI key | Enter an invalid key in the DM modal. MailDM must state it was not saved; then enter a valid key and confirm success. |
| Account purge | Note an account ID from `/accounts`, run `/disconnect account_id:ID`, then run `/accounts` again. The account must no longer appear. In the database interface, the corresponding `connected_accounts` row and its encrypted token must be absent. |
| Full deletion | Run `/delete-my-data confirm:DELETE`. The MailDM Discord-user row and cascading Gmail connections, AI credentials, schedules, jobs, summary history, and processed source IDs must be absent. Existing audit events are retained only in de-identified form. |
| Reauthorization | Revoke MailDM’s Google access from the Google Account security page, then trigger a digest. MailDM marks the account for reauthorization and directs you to `/reauthorize account_id:ID`. |
| Secret hygiene | Inspect application logs after testing. They may show status codes and safe error labels but must never contain an OAuth token, AI key, or raw email body. |

## 7. Before inviting additional users

Publish a stable custom domain you control; keep `/`, `/privacy`, `/terms`, and `/gmail-readiness` live under that same domain; verify domain ownership in Google Search Console; complete OAuth branding; and submit the restricted-scope justification and demonstration material through Google’s Verification Center. See [GOOGLE_VERIFICATION.md](./GOOGLE_VERIFICATION.md) for the launch checklist and official references.
