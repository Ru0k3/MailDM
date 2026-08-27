# MailDM Integration Sources

MailDM’s Discord Interaction endpoint follows Discord’s interaction verification guidance: validate the Ed25519 signature using the request timestamp and unmodified raw body before processing a command. Discord documentation: <https://docs.discord.com/developers/interactions/receiving-and-responding> and <https://docs.discord.com/developers/interactions/overview>.

Gmail linking uses Google’s web-server OAuth authorization-code flow with the restricted `gmail.readonly` scope. Gmail unread messages are retrieved through the messages list and get endpoints using a Gmail search query. Google documentation: <https://developers.google.com/identity/protocols/oauth2/web-server>, <https://developers.google.com/workspace/gmail/api/auth/scopes>, and <https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list>.

OpenAI summaries use the Responses API with server-side user credentials, disabled provider-side response storage, and JSON output. OpenAI documentation: <https://developers.openai.com/api/reference/resources/responses/methods/create/>.

Anthropic summaries use the Messages API with a top-level system instruction and one user-content message. Anthropic documentation: <https://platform.claude.com/docs/en/api/messages>.

NVIDIA model support uses its OpenAI-compatible inference API. NVIDIA documentation: <https://docs.nvidia.com/nim/large-language-models/latest/api-reference.html>.

Per-user daily delivery uses Manus-managed authenticated scheduled HTTP callbacks. The callback must begin with `/api/scheduled/`, use task UID lookup, and be retry-safe and idempotent.
