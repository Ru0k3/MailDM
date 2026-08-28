# MailDM multi-provider BYOK review plan

This is a design and implementation plan only. No commit or push to `main` is authorized until the user reviews and approves it.

## Current implementation audit

The current source has one credential slot in `settings`: `ai_provider`, `ai_model`, and encrypted `ai_api_key`. `/set-ai-key` overwrites that one encrypted value, `/set-ai-provider` changes the provider globally for the user, and `/set-model` changes the model string without browsing or validating a provider model list. The production MySQL/TiDB store and the SQLite test helper both mirror this shape. The summarizer already applies the untrusted-email prompt guardrail through the shared `runSummaryForUser` path; the multi-provider work will keep that path unchanged and provider-agnostic.

## Proposed schema

Add an `ai_credentials` table rather than overloading `settings`:

```sql
CREATE TABLE ai_credentials (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  provider VARCHAR(32) NOT NULL,
  label VARCHAR(120) NULL,
  base_url VARCHAR(500) NOT NULL,
  encrypted_api_key TEXT NOT NULL,
  cached_models JSON NOT NULL,
  validated_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ai_credential_user_provider_url (user_id, provider, base_url),
  CONSTRAINT fk_ai_credentials_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

Change `settings` from the old active-provider fields to an `active_ai_credential_id` foreign key, or retain the old columns temporarily as a migration bridge and stop reading them after migration. The safer migration path is to add `active_ai_credential_id`, backfill one existing credential per user from the old encrypted key, then use the new relation for all new requests. The old columns can be retained for rollback compatibility in the first release but will no longer be authoritative.

The cached model list is non-secret JSON. Every API key remains encrypted with the existing `SESSION_SECRET` AES-256-GCM path. The database layer never receives plaintext keys in production.

## Provider registry

Create one provider registry used by validation, model listing, and summarization. It will contain:

| Provider | Base URL behavior | Key validation/model listing |
|---|---|---|
| OpenAI | Fixed `https://api.openai.com/v1` | OpenAI-compatible `/models`, then a minimal chat-completions validation |
| Anthropic | Fixed `https://api.anthropic.com/v1` | Anthropic-specific models endpoint where supported, then a minimal messages validation |
| OpenRouter | Fixed `https://openrouter.ai/api/v1` | OpenAI-compatible `/models`, then chat-completions validation |
| Custom | User-supplied HTTPS URL | OpenAI-compatible `/models` and chat-completions validation; no arbitrary non-HTTPS URL |

Explicit provider selection is required for the first version. Key-prefix auto-detection is deferred because prefixes are not a reliable authorization or provider identity mechanism and could cause a secret to be sent to the wrong endpoint.

Provider adapters will return a normalized `{ id, name?, contextLength? }` model shape. Model-list results are fetched only at key-add/refresh time and stored in `cached_models`; summary generation uses the selected credential’s decrypted key, base URL, provider, and active model.

## Proposed command UX

### `/set-ai-key`

Make this a DM-only command with required `provider` and `key` options, plus optional `base_url` and `label`. Known providers use their fixed base URL and reject a user-supplied conflicting URL. `custom` requires an HTTPS `base_url` and a label. The bot validates the key, fetches the model list, stores the encrypted credential and cached models, and returns only a masked confirmation such as “OpenRouter key saved; 12 models available. Run `/models` to choose one.” It never echoes the key.

### `/models`

Add a DM-only command that groups cached models by credential. Each option will use a short opaque identifier, not the raw key or URL. The response will show provider, label, model count, and model names with Discord’s component limits respected. If the list is too large, paginate with `models:page:<token>` buttons.

### `/set-model`

Change this from accepting an arbitrary model string to accepting the opaque model-selection identifier produced by `/models`. Selecting a model updates `settings.active_ai_credential_id` and the active model stored with that credential or in a small selection table. The response names the provider and model but never exposes the key.

### `/remove-api-key`

Make this DM-only. It accepts the opaque credential identifier from `/models`, deletes only that row and its cached model list, and preserves Gmail accounts, schedule, timezone, settings, feedback, and summary history. If the removed credential is active, clear the active selection and reply explicitly that the active model was cleared and the user must run `/models` to choose another. If no credential remains, summaries fail with a clear “No AI provider configured; add a key with `/set-ai-key`” message.

### Existing commands

`/settings` will show the active provider/model and a list/count of stored credentials without exposing URLs or keys. `/summary-now` and scheduled delivery will continue calling the same shared pipeline; only the pipeline’s provider-resolution step changes from one settings key to the selected credential. `/delete-my-data` will cascade-delete all credentials through the existing user foreign key.

## Security and guardrails

All key-add, model-browse, model-select, and key-removal interactions will be rejected outside a Discord DM. Raw keys will never be placed in response text, logs, error messages, model identifiers, or callback custom IDs. Callback IDs will contain random short-lived tokens mapped to server-side choices, not provider URLs or secrets. Custom base URLs will be HTTPS-only and validated against SSRF-sensitive schemes; the initial implementation will not allow localhost, link-local, private-network, or metadata-service addresses.

The summarizer will continue to call `buildSummarizerMessages` for every provider. The system instruction that email content is untrusted data will remain in that shared function, and tests will assert that OpenAI, Anthropic, OpenRouter, and custom-provider paths all receive the same guardrail-bearing message construction.

## Migration and compatibility

The migration will preserve existing single-key users. During startup migration, a non-null legacy `settings.ai_api_key` will become one credential row using the legacy provider/model and the active selection will point to it. No plaintext key will be logged or placed in migration output. The legacy columns remain readable during one migration release but are no longer updated by new commands.

## Reviewable implementation diff

The working-copy diff will be limited to:

1. `src/db/mysql.js`, SQLite test helper, and a new migration for `ai_credentials` and active selection.
2. A provider registry and normalized adapters in the summarizer/provider layer.
3. The shared pipeline’s credential resolution and clear no-provider error.
4. Discord command definitions and DM-only handlers for `/models`, revised `/set-ai-key`, revised `/set-model`, and `/remove-api-key`.
5. README, go-live checklist, and environment documentation only where the new commands/configuration require it.
6. Mocked tests for multi-key preservation, model fetch/cache, switching across providers, non-active removal, active removal, DM-only enforcement, provider-independent prompt guardrails, and full-data cascade deletion.

No deployment, GitHub push, or `main` commit will occur before review approval.

## Open decisions for approval

The recommended decisions are: use `/models` for browsing and selecting; require explicit provider selection; use `custom` with required HTTPS base URL plus label; use opaque short-lived component IDs; use one active credential/model selection at a time; preserve legacy settings columns for one migration release; and support only fixed OpenAI, Anthropic, OpenRouter, and OpenAI-compatible custom endpoints initially.
