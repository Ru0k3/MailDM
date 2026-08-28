import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { decryptCredential, encryptCredential } from "./maildmCrypto";

const originalKey = process.env.CREDENTIAL_ENCRYPTION_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  else process.env.CREDENTIAL_ENCRYPTION_KEY = originalKey;
});

describe("MailDM credential encryption", () => {
  it("uses authenticated encryption and does not retain plaintext in ciphertext", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const plaintext = "private-provider-key-123";
    const ciphertext = encryptCredential(plaintext);
    expect(ciphertext).not.toContain(plaintext);
    expect(ciphertext.split(".")).toHaveLength(4);
    expect(decryptCredential(ciphertext)).toBe(plaintext);
  });

  it("rejects malformed encrypted credentials", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    expect(() => decryptCredential("not-an-encrypted-value")).toThrow("invalid format");
  });
});
