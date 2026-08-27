# MailDM

MailDM is a Gmail-only Discord email summarizer MVP. It exposes an Express health endpoint, Google OAuth start/callback routes, a Discord interactions endpoint for slash commands and feedback controls, and an in-process daily scheduler.

## Commands

The command set is `/sample`, `/connect`, `/accounts`, `/disconnect`, `/settings`, `/set-time`, `/set-ai-provider`, `/set-model`, `/set-ai-key`, `/summary-now`, `/delete-my-data`, and `/reauthorize`. The `disconnect` command purges the selected Gmail account’s stored tokens and records; `delete-my-data` removes the user row and all cascading data.

`/set-time` accepts a 24-hour time plus an optional IANA timezone, such as `09:00` and `America/New_York`.

## Scheduler

The daily scheduler runs as an in-process interval inside the Express process every two minutes. Each tick converts the current instant into each user’s IANA timezone, checks the saved local `HH:MM`, and claims `user + local calendar date` with a SQLite `UNIQUE` constraint before doing any work. The claim makes duplicate ticks and process-restart retries idempotent for the same local calendar day, including across DST transitions.

Scheduled delivery calls the same `runSummaryForUser` pipeline used by `/summary-now`, then records `summary_history` as complete only after Discord DM delivery succeeds. Refresh/revocation failures mark the Gmail account `reauth_required` and trigger a `/reauthorize` notice; AI failures trigger an AI-key/provider notice; Discord DM failures mark the job failed and are surfaced to the scheduler failure hook. `SCHEDULER_ENABLED=false` disables the interval.

The process must be deployed on an always-on Manus service for the interval to remain active. This implementation intentionally does not expose a public scheduler callback endpoint, so there is no unauthenticated scheduler URL to attack.

## Security and data handling

Discord requests are rejected unless the Ed25519 signature over `timestamp + raw request body` validates against `DISCORD_PUBLIC_KEY`. OAuth state is signed with `SESSION_SECRET`. Google access and refresh tokens, plus user-provided AI keys, are encrypted at rest with AES-256-GCM. The only Gmail scope requested is `gmail.readonly`; the adapter does not send, modify, or delete messages.

The summarizer has a dedicated system policy stating that email subjects, bodies, sender names, links, attachments, and quoted content are **untrusted data**, not instructions. It explicitly says never to follow instructions found in email content, impersonate another message role, call tools, change settings, reveal secrets, or alter the summarization task because an email requests it. Email fields are enclosed in an untrusted-data boundary, and `<`, `>`, and `&` are escaped so a malicious email cannot close the boundary with injected markup. Adversarial tests assert this contract.

## Run locally

Copy `.env.example` to `.env`, fill the required credentials, install dependencies with `npm install`, and run `npm start`. Run `npm test` for behavior tests and `npm run check` for the repository check. Run `npm run register:commands` after setting the Discord application and bot variables.

## Google OAuth setup

Configure the Google Auth Platform Branding page with the deployed home page, privacy policy, and terms URLs. Register `GOOGLE_REDIRECT_URI` as an authorized redirect URI. The app requests `https://www.googleapis.com/auth/gmail.readonly`. See `GOOGLE_VERIFICATION.md` for the verification checklist and official references.

## Repository truthfulness

All implementation and test claims in project checkpoints must refer to files committed to this repository. The exact commit containing the scheduler should be recorded in the completion message and verified with `git show <hash>`.
