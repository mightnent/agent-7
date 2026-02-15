import { describe, expect, it } from "vitest";

import { resetBootstrapEnvCacheForTests } from "@/lib/bootstrap-env";

import { decryptSetting, encryptSetting } from "./settings-cipher";

describe("settings-cipher", () => {
  it("round-trips plaintext with AES-256-GCM", () => {
    const originalKey = process.env.DB_ENCRYPTION_KEY;
    process.env.DB_ENCRYPTION_KEY = "a".repeat(64);
    resetBootstrapEnvCacheForTests();

    const encrypted = encryptSetting("secret-value");
    const decrypted = decryptSetting(encrypted);

    expect(Buffer.isBuffer(encrypted)).toBe(true);
    expect(decrypted).toBe("secret-value");

    if (originalKey === undefined) {
      delete process.env.DB_ENCRYPTION_KEY;
    } else {
      process.env.DB_ENCRYPTION_KEY = originalKey;
    }
    resetBootstrapEnvCacheForTests();
  });
});
