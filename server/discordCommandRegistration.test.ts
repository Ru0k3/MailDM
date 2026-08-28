import { describe, expect, it } from "vitest";
import { registerDiscordCommands } from "./discordCommandRegistration";

describe("Discord command registration resilience", () => {
  it("contains network failures instead of rejecting during server startup", async () => {
    const result = await registerDiscordCommands(async () => {
      throw new TypeError("self-signed certificate");
    });

    expect(result).toEqual({ ok: false, reason: "network_error" });
  });
});
