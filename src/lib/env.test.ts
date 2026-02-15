import { describe, expect, it } from "vitest";

import { parseEnv } from "./env";

const baseEnv = {
  NODE_ENV: "test",
  MANUS_API_KEY: "manus-api-key",
  MANUS_BASE_URL: "https://api.manus.ai",
  MANUS_WEBHOOK_SECRET: "super-secret-webhook",
  MANUS_AGENT_PROFILE: "manus-1.6",
  WHATSAPP_AUTH_DIR: "./.data/whatsapp-auth",
  WHATSAPP_SESSION_NAME: "default",
  INTERNAL_CLEANUP_TOKEN: "internal-cleanup-token",
} satisfies Record<string, string>;

describe("parseEnv", () => {
  it("accepts a valid environment map", () => {
    const env = parseEnv(baseEnv);

    expect(env.MANUS_API_KEY).toBe(baseEnv.MANUS_API_KEY);
    expect(env.MANUS_AGENT_PROFILE).toBe("manus-1.6");
  });

  it("applies defaults for optional values", () => {
    const env = parseEnv({
      MANUS_API_KEY: baseEnv.MANUS_API_KEY,
      MANUS_WEBHOOK_SECRET: baseEnv.MANUS_WEBHOOK_SECRET,
      INTERNAL_CLEANUP_TOKEN: baseEnv.INTERNAL_CLEANUP_TOKEN,
    });

    expect(env.NODE_ENV).toBe("development");
    expect(env.MANUS_BASE_URL).toBe("https://api.manus.ai");
    expect(env.WHATSAPP_SESSION_NAME).toBe("default");
  });

  it("throws when url-like keys are invalid", () => {
    expect(() => parseEnv({ ...baseEnv, MANUS_BASE_URL: "not-a-url" })).toThrowError();
  });
});
