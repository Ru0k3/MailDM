# Google OAuth verification checklist

## Current project state

The Google Cloud project is `maildm-506818` (MailDM). The OAuth app is currently in Testing. Google’s Verification Center reports that verification is not required while the publishing status remains Testing; publication is blocked until Branding is completed.

## Branding requirements

Complete the following fields in Google Auth Platform → Branding:

| Field | Required value |
|---|---|
| App name | MailDM |
| User support email | `ramakrishnadulam10@gmail.com` or an approved support address |
| Application home page | The deployed MailDM home page URL |
| Privacy policy | The deployed MailDM privacy-policy URL |
| Terms of service | The deployed MailDM terms URL, if used |
| Authorized domain | The registrable domain hosting the URLs and OAuth callback |
| Logo | Optional for Testing; add a square logo before production if desired |

The URLs must be real, publicly reachable pages owned by the project operator. Do not submit placeholder or invented URLs.

## Scope and data-use statement

MailDM requests only `https://www.googleapis.com/auth/gmail.readonly`. It reads recent messages to prepare a summary, does not send, modify, label, archive, or delete Gmail messages, and provides `/disconnect` and `/delete-my-data` controls. User-provided AI keys and Google tokens are encrypted at rest. Email content is sent to the selected AI provider only to produce the requested summary.

The summarizer explicitly treats all email content as untrusted data, not instructions. This includes prompt-injection text that attempts to impersonate a system message, change the summarization task, request tool calls, or exfiltrate secrets.

## Submission sequence

After Branding is complete, review Audience, add authorized test users, validate the deployed OAuth callback, and use Publish app to move out of Testing. If Google presents a verification request, attach the public home/privacy/terms URLs, an accurate scope justification, a screen recording showing the OAuth flow and Gmail-only read behavior, and test credentials or reviewer instructions as requested. Google may request additional verification or a security assessment depending on the scopes and use case.

## Official references

1. [Configure the OAuth consent screen](https://developers.google.com/workspace/guides/configure-oauth-consent)
2. [Submit for brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
3. [Choose Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
4. [OAuth App Verification Help Center](https://support.google.com/cloud/answer/13463073)
