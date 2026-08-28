# Google OAuth Verification Preparation

## Current status

MailDM should begin in **Google OAuth Testing** status with only the operator's selected Gmail addresses listed as test users. This supports the private end-to-end proof of concept while the public-production materials are prepared. Google documents that testing projects may remain unverified, but named test users see a warning and refresh tokens have a limited lifetime.[1]

## Before public Gmail access

| Requirement | MailDM status | Operator action |
| --- | --- | --- |
| Minimal scope | Ready | Request only `https://www.googleapis.com/auth/gmail.readonly`. |
| Public homepage | Ready | Publish the MailDM home page on a stable production URL. |
| Privacy policy | Ready | Publish `/privacy` on the same production domain and review the contact section with an operating email. |
| Terms | Ready | Publish `/terms` on the same production domain. |
| Owned domain | Pending operator action | Connect a custom domain you control and verify the top private domain in Google Search Console. Do not rely on a temporary preview URL for production verification. |
| Google consent branding | Pending operator action | Enter MailDM's name, support email, developer contact, homepage, privacy URL, terms URL, and logo in Google Auth Platform. |
| Verification submission | Pending operator action | Publish branding, then use Google Auth Platform Verification Center to justify `gmail.readonly`, provide an unlisted English consent/data-use demo video, and answer follow-up requests. |
| Security assessment | Plan before public rollout | Google states that applications accessing restricted data through a third-party server require an annual approved third-party assessment, unless an exception applies.[1] |

## Required disclosure alignment

The deployed home page and privacy policy state that MailDM reads only unread Gmail messages with `gmail.readonly`, does not change Gmail state, uses bounded data to create the requested brief with the user-selected AI provider, encrypts refresh tokens and user-provided AI keys, does not retain raw message bodies, and supports disconnect-and-purge through Discord DM commands.

## Demo video outline

Record an **unlisted** English video after the private test flow succeeds. Show: the public MailDM page; the Discord `/sample` command; a user-initiated `/connect gmail` request; the Google consent screen and requested read-only scope; successful account linking; `/accounts`; AI-provider/model/key configuration without exposing the key; `/set-time`; a real `/summary-now` result; and `/disconnect` or `/delete-my-data` to show control and deletion.

## References

[1]: https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification "Google: Restricted scope verification"

[2]: https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification "Google: Submit for brand verification"

[3]: https://developers.google.com/identity/protocols/oauth2/policies "Google OAuth 2.0 Policies"

[4]: https://support.google.com/cloud/answer/13806988?hl=en "Google Cloud: App Privacy Policy"
