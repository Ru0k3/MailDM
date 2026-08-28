export const SOURCE_PROVIDERS = ["gmail", "outlook", "slack", "github"] as const;
export type SourceProvider = (typeof SOURCE_PROVIDERS)[number];

export const AI_PROVIDERS = ["openai", "anthropic", "nvidia", "compatible"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export type NormalizedSourceItem = {
  sourceProvider: SourceProvider;
  sourceAccountId: number;
  externalId: string;
  threadId?: string;
  sourceLabel: string;
  sender: string;
  subject: string;
  receivedAt: Date;
  text: string;
  importance?: "low" | "normal" | "high";
  webUrl?: string;
};

export type SourceFetchLimits = {
  maxItems: number;
  maxBodyCharacters: number;
  maxTotalCharacters: number;
};

export type SourceProviderAdapter = {
  readonly provider: SourceProvider;
  fetchUnreadItems(input: {
    accountId: number;
    encryptedRefreshToken: string;
    limits: SourceFetchLimits;
    processedExternalIds: Set<string>;
  }): Promise<NormalizedSourceItem[]>;
};

export type StructuredBriefItem = {
  sourceLabel: string;
  subject: string;
  sender: string;
  priority: "high" | "medium" | "low";
  summary: string;
  reason: string;
  webUrl?: string;
};

export type StructuredBrief = {
  headline: string;
  overview: string;
  items: StructuredBriefItem[];
  noImportantMail: boolean;
};

export type AiProviderAdapter = {
  readonly provider: AiProvider;
  validateCredential(apiKey: string): Promise<{ valid: boolean; safeMessage?: string }>;
  createBrief(input: {
    apiKey: string;
    model: string;
    items: NormalizedSourceItem[];
  }): Promise<StructuredBrief>;
};

export type DeliveryAdapter = {
  sendDirectMessage(input: { discordUserId: string; content: string }): Promise<{ deliveryId: string }>;
};

export const NO_IMPORTANT_MAIL_MESSAGE = "No important unread mail today";
