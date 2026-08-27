import type { Express, Request, Response } from "express";
import { ENV } from "./_core/env";

export function registerMaildmStatusRoutes(app: Express) {
  app.get("/api/maildm/status", (_req: Request, res: Response) => {
    const discordReady = Boolean(ENV.discordApplicationId && ENV.discordPublicKey && ENV.discordBotToken);
    const googleReady = Boolean(ENV.googleClientId && ENV.googleClientSecret && ENV.googleRedirectUri);
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      service: "MailDM",
      status: discordReady && googleReady ? "ready" : "setup_required",
      checks: {
        discordInteractions: discordReady,
        gmailOAuth: googleReady,
        credentialEncryption: Boolean(process.env.CREDENTIAL_ENCRYPTION_KEY),
        scheduledDelivery: true,
      },
      generatedAt: new Date().toISOString(),
    });
  });
}
