import type { AiProvider } from "./maildmTypes";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

export const SUMMARY_LIMITS = {
  maxItems: 18,
  maxBodyCharacters: 1_800,
  maxTotalCharacters: 16_000,
  maxDiscordMessageCharacters: 1_900,
} as const;

export const RECOMMENDED_MODELS: Record<AiProvider, readonly string[]> = {
  openai: ["gpt-4o-mini", "gpt-4.1-mini"],
  anthropic: ["claude-haiku-4-5-20251001", "claude-sonnet-4-5-20250929"],
  nvidia: ["meta/llama-3.3-70b-instruct", "deepseek-ai/deepseek-r1"],
  compatible: [],
};

export const getRecommendedModels = (provider: AiProvider): readonly string[] => RECOMMENDED_MODELS[provider];

export const isRecommendedModel = (provider: AiProvider, model: string): boolean =>
  getRecommendedModels(provider).includes(model);
