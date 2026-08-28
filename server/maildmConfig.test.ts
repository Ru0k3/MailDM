import { describe, expect, it } from "vitest";
import { getRecommendedModels, isRecommendedModel } from "./maildmConfig";

describe("MailDM recommended model catalogue", () => {
  it("keeps model selection constrained to supported provider recommendations", () => {
    expect(getRecommendedModels("openai")).toContain("gpt-4o-mini");
    expect(isRecommendedModel("nvidia", "deepseek-ai/deepseek-r1")).toBe(true);
    expect(isRecommendedModel("anthropic", "gpt-4o-mini")).toBe(false);
  });
});
