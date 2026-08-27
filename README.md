# MailDM

MailDM is a Gmail-only Discord email summarizer MVP. It exposes an Express health endpoint, Google OAuth start/callback routes, and a Discord interactions endpoint for slash commands and feedback controls.

## Commands

The command set is `/sample`, `/connect`, `/accounts`, `/disconnect`, `/settings`, `/set-time`, `/set-ai-provider`, `/set-model`, `/set-ai-key`, `/summary-now`, `/delete-my-data`, and `/reauthorize`. The `disconnect` command purges the selected Gmail account’s stored tokens and records; `delete-my-data` removes the user row and all cascading data.

## Security and data handling

Discord requests are rejected unless the Ed25519 signature over `timestamp + raw request body` validates against `DISCORD_PUBLIC_KEY`. OAuth state is signed with `SESSION_SECRET`. Google access and refresh tokens, plus user-provided AI keys, are encrypted at rest with AES-256-GCM. The only Gmail scope requested is `gmail.readonly`; the adapter does not send, modify, or delete messages.

The summarizer has a dedicated system policy stating that email subjects, bodies, sender names, links, attachments, and quoted content are untrusted data. Email text is placed inside explicit delimiters and is never allowed to override the system policy, call tools, change settings, reveal secrets, or act as a message from another role. Adversarial tests assert this contract.

## Run locally

Copy `.env.example` to `.env`, fill the required credentials, install dependencies with `npm install`, and run `npm start`. Run `npm test` for behavior tests and `npm run check` for JavaScript type checking. Run `npm run register:commands` after setting the Discord application and bot variables.

## Google OAuth setup

Configure the Google Auth Platform Branding page with the deployed home page, privacy policy, and terms URLs. Register `GOOGLE_REDIRECT_URI` as an authorized redirect URI. The app requests `https://www.googleapis.com/auth/gmail.readonly`. See `GOOGLE_VERIFICATION.md` for the verification checklist and official references.

## Repository truthfulness

All implementation and test claims in project checkpoints must refer to files committed to this repository. The exact commit containing this reconstructed MVP should be recorded in the completion message and verified with `git show <hash>`.
