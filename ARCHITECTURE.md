# MailDM Architecture

## Purpose

MailDM is a Discord-first Gmail briefing application. It receives verified Discord HTTP Interactions, links Gmail accounts through Google OAuth, processes unread email in memory, requests a concise structured brief from a user-selected AI provider, and sends the result to the user through a Discord direct message.

## Security boundaries

| Boundary | Control |
| --- | --- |
| Discord interactions | Each request is verified against Discord's Ed25519 signature using the raw request body, timestamp, and configured application public key before it is parsed or acted upon. |
| Gmail authorization | Google OAuth uses an opaque, single-use, expiring state record tied to the Discord user who initiated linking. The callback requires the exact configured redirect URI and consumes the state transactionally. |
| Gmail access | Only the Gmail `gmail.readonly` scope is requested. The application never calls Gmail operations that change message state, labels, or folders. |
| Credentials | Gmail refresh tokens and user-owned AI provider keys are encrypted with server-side AES-256-GCM before persistence. Plaintext credentials are never logged, returned by API procedures, or retained in audit records. |
| User API keys | `/set-ai-key` is accepted only in a Discord bot direct-message interaction. Server/guild invocations receive an ephemeral instruction to continue in DM. |
| Scheduled callbacks | Scheduled HTTP callbacks authenticate through the managed platform identity, locate schedules only by immutable task UID, and use database claims plus delivery idempotency keys. |
| Untrusted content | Email bodies are sanitized, length-bounded, and treated only as source material. Instructions contained in email are never treated as MailDM commands. |

## Core entities

| Entity | Responsibility |
| --- | --- |
| Discord user | A Discord identity with timezone, desired delivery time, and Discord DM destination. |
| Connected account | One Gmail identity linked to one Discord user. Stores label, email address, encrypted OAuth refresh token, and connection state. |
| AI credential | One encrypted provider API key per Discord user and provider; a user activates one provider/model pair at a time. |
| OAuth state | A short-lived, single-use authorization state record tied to the initiating Discord user and requested account label. |
| Delivery schedule | A user's local time, IANA timezone, current platform callback task UID, and last-computed UTC schedule. |
| Summary job | An idempotent record for a user and scheduled delivery date. It records claim, provider call, delivery result, and safe error codes only. |
| Processed source item | A provider message identifier and hash used to prevent repeat delivery while a message remains unread. It never stores the message body. |

## Request and delivery flow

```text
Discord slash command
    → verified HTTP interaction
    → MailDM command handler
    → Google OAuth link or secure configuration update
    → encrypted configuration persisted

Managed scheduled callback
    → task UID authentication
    → schedule lookup and transactional job claim
    → Gmail read-only fetch
    → in-memory sanitization, limits, filtering, deduplication
    → user-selected AI provider adapter
    → structured brief validation
    → Discord REST direct-message delivery
    → safe history and idempotency records
```

## Retention policy

MailDM retains account metadata, encrypted credentials, schedule preferences, summary text, source identifiers, and safe delivery/error status. It does not retain raw Gmail message bodies, raw Gmail API payloads, plaintext provider keys, plaintext OAuth tokens, or secret-bearing request bodies.

## Extensibility

All source connectors implement a common normalization interface and all AI providers implement a common structured-summary interface. Gmail is the only enabled source in the initial release. Outlook, Slack, and GitHub notifications are represented as future provider types but are not enabled until their separate permission and testing work is complete.
