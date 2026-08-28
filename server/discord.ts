import { createPublicKey, verify } from "node:crypto";
import type { Request, Response } from "express";
import { ENV } from "./_core/env";

const DISCORD_API = "https://discord.com/api/v10";
const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

export type DiscordInteraction = {
  id: string;
  type: number;
  token: string;
  guild_id?: string;
  message?: { id?: string };
  member?: { user?: { id: string; username?: string; global_name?: string } };
  user?: { id: string; username?: string; global_name?: string };
  data?: { name?: string; custom_id?: string; options?: Array<{ name: string; value?: string | number | boolean }> };
};

function discordPublicKey(publicKeyHex: string) {
  const raw = Buffer.from(publicKeyHex, "hex");
  if (raw.length !== 32) throw new Error("Discord public key is not configured");
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  return createPublicKey({ key: Buffer.concat([spkiPrefix, raw]), format: "der", type: "spki" });
}

export function verifyDiscordPayload(input: { publicKeyHex: string; timestamp: string; signatureHex: string; rawBody: Buffer; nowMs?: number }): boolean {
  const { publicKeyHex, timestamp, signatureHex, rawBody, nowMs = Date.now() } = input;
  const signature = signatureHex;
  if (!timestamp || !signature || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const age = Math.abs(nowMs - Number(timestamp) * 1000);
  if (!Number.isFinite(age) || age > SIGNATURE_MAX_AGE_MS) return false;
  try {
    return verify(null, Buffer.concat([Buffer.from(timestamp), rawBody]), discordPublicKey(publicKeyHex), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

export function verifyDiscordRequest(req: Request, rawBody: Buffer): boolean {
  return verifyDiscordPayload({
    publicKeyHex: ENV.discordPublicKey,
    timestamp: req.header("x-signature-timestamp") ?? "",
    signatureHex: req.header("x-signature-ed25519") ?? "",
    rawBody,
  });
}

export function commandOption(interaction: DiscordInteraction, name: string): string | undefined {
  const value = interaction.data?.options?.find(option => option.name === name)?.value;
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

export function interactionUser(interaction: DiscordInteraction) {
  const user = interaction.user ?? interaction.member?.user;
  if (!user?.id) throw new Error("Discord interaction is missing a user");
  return { id: user.id, displayName: user.global_name ?? user.username ?? null };
}

export function isDirectMessageInteraction(interaction: DiscordInteraction): boolean {
  return !interaction.guild_id;
}

export function interactionResponse(res: Response, content: string, options: { ephemeral?: boolean } = {}) {
  return res.status(200).json({
    type: 4,
    data: { content, flags: options.ephemeral ? 64 : undefined },
  });
}

export function deferredInteractionResponse(res: Response) {
  return res.status(200).json({ type: 5 });
}

export function componentAcknowledgement(res: Response) {
  return res.status(200).json({ type: 6 });
}

export async function sendDiscordInteractionFollowup(interactionToken: string, content: string) {
  if (!ENV.discordApplicationId) throw new Error("Discord application ID is not configured");
  const response = await fetch(`${DISCORD_API}/webhooks/${ENV.discordApplicationId}/${interactionToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) throw new Error(`Discord interaction follow-up failed with ${response.status}`);
}

export async function sendDiscordDirectMessage(discordUserId: string, content: string, options: { components?: unknown[] } = {}): Promise<{ deliveryId: string }> {
  if (!ENV.discordBotToken) throw new Error("Discord bot token is not configured");
  const headers = { Authorization: `Bot ${ENV.discordBotToken}`, "Content-Type": "application/json" };
  const channelResponse = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: "POST",
    headers,
    body: JSON.stringify({ recipient_id: discordUserId }),
  });
  if (!channelResponse.ok) throw new Error(`Discord DM channel request failed with ${channelResponse.status}`);
  const channel = (await channelResponse.json()) as { id?: string };
  if (!channel.id) throw new Error("Discord DM channel was not returned");

  const messageResponse = await fetch(`${DISCORD_API}/channels/${channel.id}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content, components: options.components }),
  });
  if (!messageResponse.ok) throw new Error(`Discord message delivery failed with ${messageResponse.status}`);
  const message = (await messageResponse.json()) as { id?: string };
  if (!message.id) throw new Error("Discord did not return a message identifier");
  return { deliveryId: message.id };
}
