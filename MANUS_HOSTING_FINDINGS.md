# Manus hosting findings

Checked 2026-08-28 against official Manus documentation.

The official Publishing documentation says the default Autoscale mode runs on Google Cloud Run, scales from zero when there is no traffic, has cold starts after inactivity, and is billed at $0 when idle. It explicitly says background workers and queues are not supported in Autoscale.

The same documentation says Reserved hosting runs on one reserved instance continuously, with no cold starts and no request timeout. It is intended for background workers, bots, message queues, and long-running jobs. The project can switch hosting modes from project settings; this is a hosting-mode setting, not an application-code change. Reserved uses 1 vCPU and 512 MB and is usage billed, with the official docs quoting up to approximately $36/month at full utilization and a shared $10 monthly usage credit.

Official sources:

- https://manus.im/docs/website-builder/publishing#hosting-modes
- https://manus.im/blog/manus-hosting-web-builder

Repository implication: the current in-process two-minute scheduler is production-safe only when the published MailDM project is set to Reserved hosting. The available task context does not expose a Manus WebDev project ID or hosting-mode metadata for MailDM, and the GitHub repository alone cannot prove which Manus project/mode is currently published. If the user’s actual published project is Autoscale, it can scale to zero and the interval is not reliable; switch that project to Reserved before using the in-process scheduler in production.
