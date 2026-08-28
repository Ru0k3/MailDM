import type { Express, Request, Response } from "express";
import { ENV } from "./_core/env";
import { GMAIL_READONLY_SCOPE, GOOGLE_AUTHORIZATION_URL, GOOGLE_TOKEN_URL, GOOGLE_USERINFO_URL } from "./maildmConfig";
import { decryptCredential, encryptCredential, sha256 } from "./maildmCrypto";
import { consumeOAuthState, getGmailAccount, upsertGmailAccount } from "./maildmDb";

type GoogleTokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; token_type?: string };
type GoogleProfile = { email?: string; email_verified?: boolean };

export async function createGmailAuthorizationUrl(discordUserId: number, label: string, createState: (input: { stateHash: string; discordUserId: number; provider: "gmail"; requestedLabel: string; redirectUri: string; expiresAt: Date }) => Promise<void>) {
  if (!ENV.googleClientId || !ENV.googleRedirectUri) throw new Error("Google OAuth is not configured yet");
  const state = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  await createState({ stateHash: sha256(state), discordUserId, provider: "gmail", requestedLabel: label, redirectUri: ENV.googleRedirectUri, expiresAt: new Date(Date.now() + 15 * 60 * 1000) });
  const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_URL);
  authorizationUrl.search = new URLSearchParams({
    client_id: ENV.googleClientId,
    redirect_uri: ENV.googleRedirectUri,
    response_type: "code",
    scope: GMAIL_READONLY_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  }).toString();
  return authorizationUrl.toString();
}

async function exchangeGoogleCode(code: string): Promise<{ accessToken: string; refreshToken: string; expiresIn?: number; scope?: string }> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: ENV.googleClientId, client_secret: ENV.googleClientSecret, redirect_uri: ENV.googleRedirectUri, grant_type: "authorization_code" }),
  });
  if (!response.ok) throw new Error(`Google token exchange failed with ${response.status}`);
  const payload = (await response.json()) as GoogleTokenResponse;
  if (!payload.access_token || !payload.refresh_token) throw new Error("Google did not return a refresh token");
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: payload.expires_in,
    scope: payload.scope,
  };
}

async function getGoogleProfile(accessToken: string) {
  const response = await fetch(GOOGLE_USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Google profile request failed with ${response.status}`);
  const profile = (await response.json()) as GoogleProfile;
  if (!profile.email || !profile.email_verified) throw new Error("Google did not return a verified email address");
  return profile.email.toLowerCase();
}

export function registerGmailOAuthRoutes(app: Express) {
  app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const stateValue = typeof req.query.state === "string" ? req.query.state : "";
    if (!code || !stateValue || !ENV.googleRedirectUri) return res.redirect("/oauth/error");

    try {
      const state = await consumeOAuthState(sha256(stateValue));
      if (!state || state.provider !== "gmail" || state.redirectUri !== ENV.googleRedirectUri) return res.redirect("/oauth/error");
      const tokens = await exchangeGoogleCode(code);
      const accountEmail = await getGoogleProfile(tokens.accessToken);
      await upsertGmailAccount({
        discordUserId: state.discordUserId,
        accountEmail,
        label: state.requestedLabel,
        encryptedRefreshToken: encryptCredential(tokens.refreshToken),
        encryptedAccessToken: encryptCredential(tokens.accessToken),
        tokenExpiresAt: tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000) : null,
        grantedScopes: tokens.scope ?? GMAIL_READONLY_SCOPE,
      });
      return res.redirect("/oauth/success");
    } catch {
      return res.redirect("/oauth/error");
    }
  });
}

export async function refreshGoogleAccessToken(encryptedRefreshToken: string) {
  const refreshToken = decryptCredential(encryptedRefreshToken);
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: ENV.googleClientId, client_secret: ENV.googleClientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  if (!response.ok) throw new Error(`Google token refresh failed with ${response.status}`);
  const payload = (await response.json()) as GoogleTokenResponse;
  if (!payload.access_token) throw new Error("Google token refresh returned no access token");
  return payload.access_token;
}

export async function revokeGoogleRefreshToken(encryptedRefreshToken: string) {
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: decryptCredential(encryptedRefreshToken) }),
  });
  return response.ok;
}

export async function reauthorizationRequired(accountId: number) {
  const account = await getGmailAccount(accountId);
  return account?.status === "reauthorization_required";
}
