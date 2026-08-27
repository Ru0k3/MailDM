import { createDecipheriv, createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

const discordToken = process.env.DISCORD_BOT_TOKEN ?? "";
const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY ?? "";

describe("MailDM protected credential validation", () => {
  it("authenticates the configured Discord bot token against the bot identity endpoint", async () => {
    expect(discordToken).not.toHaveLength(0);

    const response = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bot ${discordToken}` },
    });

    expect(response.status).toBe(200);
    const bot = (await response.json()) as { id?: string; bot?: boolean };
    expect(bot.id).toMatch(/^\d+$/);
    expect(bot.bot).toBe(true);
  }, 15_000);

  it("uses a valid 32-byte key for authenticated credential encryption", () => {
    const key = Buffer.from(encryptionKey, "base64");
    expect(key).toHaveLength(32);

    const iv = randomBytes(12);
    const plaintext = Buffer.from("maildm-credential-check", "utf8");
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    expect(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")).toBe(
      "maildm-credential-check"
    );
  });
});
