import { ENV } from "./_core/env";

type Choice = { name: string; value: string };
const choices = (values: readonly string[]): Choice[] => values.map(value => ({ name: value, value }));

const commandDefinitions = [
  { name: "start", description: "Start MailDM private onboarding" },
  { name: "help", description: "Show MailDM commands" },
  { name: "connect", description: "Connect a Gmail account", options: [{ type: 3, name: "provider", description: "Only Gmail is available now", required: true, choices: [{ name: "Gmail", value: "gmail" }] }, { type: 3, name: "label", description: "A private account label, e.g. Work", required: false }] },
  { name: "accounts", description: "List connected Gmail accounts" },
  { name: "disconnect", description: "Disconnect a Gmail account", options: [{ type: 4, name: "account_id", description: "ID shown by /accounts", required: true }] },
  { name: "reauthorize", description: "Reauthorize a Gmail account", options: [{ type: 4, name: "account_id", description: "ID shown by /accounts", required: true }] },
  { name: "set-ai-provider", description: "Select an AI provider", options: [{ type: 3, name: "provider", description: "Your provider", required: true, choices: choices(["openai", "anthropic", "nvidia"]) }] },
  { name: "set-model", description: "Select a recommended model", options: [{ type: 3, name: "model", description: "A model from your selected provider", required: true, choices: choices(["gpt-4o-mini", "gpt-4.1-mini", "claude-haiku-4-5-20251001", "claude-sonnet-4-5-20250929", "meta/llama-3.3-70b-instruct", "deepseek-ai/deepseek-r1"]) }] },
  { name: "set-ai-key", description: "Securely set your selected provider API key" },
  { name: "set-time", description: "Set daily local delivery time", options: [{ type: 3, name: "time", description: "24-hour time, e.g. 08:00", required: true }, { type: 3, name: "timezone", description: "IANA timezone, e.g. Asia/Kolkata", required: true }] },
];

export async function registerDiscordCommands() {
  if (!ENV.discordApplicationId || !ENV.discordBotToken) return;
  const response = await fetch(`https://discord.com/api/v10/applications/${ENV.discordApplicationId}/commands`, {
    method: "PUT",
    headers: { Authorization: `Bot ${ENV.discordBotToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(commandDefinitions),
  });
  if (!response.ok) console.error(`[Discord] Command registration failed with ${response.status}`);
}
