# Completion status

## Google OAuth status verified on 2026-08-28

The Google Cloud project is `maildm-506818` (MailDM), and the authenticated account is `ramakrishnadulam10@gmail.com`. Google Auth Platform reports that the app is still in **Testing**, so verification is not required while that publishing status remains. The Audience page cannot publish yet because Branding is incomplete: the application home page, privacy-policy URL, and terms-of-service URL are blank, and no logo is configured. The deployed URLs must be supplied before Google Branding and production publication can be completed.

## Repository-backed MVP

The prior empty repository state was corrected in commit `5d8340067a2ef4a72a35bc3f2cfe244b97d8310d`. That commit contains the Express app, Discord signature verification and interactions endpoint, Google OAuth start/callback, Gmail read-only adapter, SQLite schema, all requested slash commands, provider adapters, prompt-injection guardrails, public readiness pages, and tests.

## Autoscale-safe scheduler

The external-trigger scheduler extension is committed in the follow-up commit recorded below. It removes the in-process interval and exposes `POST /api/scheduler/tick`. The endpoint requires the `X-Scheduler-Secret` header to match `SCHEDULER_SECRET` using constant-time comparison before any scheduler work occurs. The scheduler retains IANA timezone/DST-aware due detection, the widened ten-minute window, the unique user/local-date claim, the shared `runSummaryForUser` pipeline, `summary_history`, and reauth/AI/Discord failure handling.

Recommended trigger: configure cron-job.org to send a POST every five minutes with an empty body and the `X-Scheduler-Secret` header. GitHub Actions is included as an alternative in `.github/workflows/scheduler-ping.yml` using `MAILDM_BASE_URL` and `SCHEDULER_SECRET` repository secrets.

## Hosting finding

Official Manus documentation confirms that Autoscale can scale to zero while idle, while Reserved remains continuously running. The external callback removes the need for Reserved hosting for the scheduler, provided an external scheduler is actually configured. See `MANUS_HOSTING_FINDINGS.md` for the source URLs and verified behavior.

## Scheduler commit

The exact commit containing this external-trigger implementation must be recorded here only after final validation and push to GitHub.
