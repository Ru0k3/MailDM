# Project TODO

- [x] Define MailDM domain models, security boundaries, provider contracts, and retention rules.
- [x] Create a secure database schema and migration for Discord identities, Gmail connections, encrypted credentials, schedules, jobs, delivery history, and audit-safe events.
- [x] Build a polished MailDM landing page, live status view, and public OAuth success/error pages.
- [x] Implement Discord HTTP Interaction signature verification, slash-command routing, and Discord REST API DM delivery.
- [x] Implement multi-user, multi-Gmail-account configuration with labels, account attribution, disconnect, and reauthorization flows.
- [x] Implement Google OAuth authorization-code linking with one-time state validation and encrypted refresh-token persistence.
- [x] Implement strictly read-only Gmail unread-message retrieval, in-memory sanitization, bounded normalization, filtering, and deduplication.
- [x] Implement DM-only AI provider credential setup, fixed recommended model lists, validation, encryption, and safe credential handling.
- [x] Implement structured summary generation through extensible AI provider adapters and retain only safe summary metadata/history.
- [x] Implement per-user timezone scheduling through managed scheduled HTTP callbacks with transactional claims, idempotent delivery, retry-safe behavior, and the exact no-mail message.
- [x] Implement Gmail reauthorization prompts and retry-safe callback rearming for transient digest failures.
- [x] Define extensible source and delivery interfaces for later Outlook, Slack, and read-only GitHub notification integrations.
- [x] Add unit tests, integration-focused tests, project documentation, and secure deployment configuration guidance.
- [x] Perform type checks, run tests, and verify the rendered experience at desktop and mobile sizes.
- [ ] Save a Manus checkpoint and provide secure end-to-end setup and test instructions.
