import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { commandOption, isDirectMessageInteraction, verifyDiscordPayload } from "./discord";

describe("MailDM Discord security", () => {
  it("accepts a current valid Discord Ed25519 signature and rejects expired requests", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const publicDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
    const publicKeyHex = publicDer.subarray(-32).toString("hex");
    const now = 1_786_000_000_000;
    const timestamp = String(Math.floor(now / 1000));
    const rawBody = Buffer.from('{"type":1}');
    const signatureHex = sign(null, Buffer.concat([Buffer.from(timestamp), rawBody]), privateKey).toString("hex");

    expect(verifyDiscordPayload({ publicKeyHex, timestamp, signatureHex, rawBody, nowMs: now })).toBe(true);
    expect(verifyDiscordPayload({ publicKeyHex, timestamp, signatureHex, rawBody, nowMs: now + 301_000 })).toBe(false);
  });

  it("supports numeric command options and recognizes DM interactions", () => {
    const interaction = { id: "1", type: 2, token: "token", user: { id: "u" }, data: { options: [{ name: "account_id", value: 42 }] } };
    expect(commandOption(interaction, "account_id")).toBe("42");
    expect(isDirectMessageInteraction(interaction)).toBe(true);
    expect(isDirectMessageInteraction({ ...interaction, guild_id: "guild" })).toBe(false);
  });
});
