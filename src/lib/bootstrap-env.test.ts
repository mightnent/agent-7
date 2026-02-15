import { describe, expect, it } from "vitest";

import { parseBootstrapEnv } from "./bootstrap-env";

describe("parseBootstrapEnv", () => {
  it("accepts valid bootstrap env", () => {
    const parsed = parseBootstrapEnv({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/manus_whatsapp",
      DB_ENCRYPTION_KEY: "f".repeat(64),
    });

    expect(parsed.NODE_ENV).toBe("test");
    expect(parsed.DATABASE_URL).toContain("postgresql://");
  });

  it("throws for invalid DB_ENCRYPTION_KEY", () => {
    expect(() =>
      parseBootstrapEnv({
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/manus_whatsapp",
        DB_ENCRYPTION_KEY: "short",
      }),
    ).toThrowError();
  });

  it("accepts a base64-encoded 32-byte DB_ENCRYPTION_KEY", () => {
    const parsed = parseBootstrapEnv({
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/manus_whatsapp",
      DB_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    });

    expect(parsed.DB_ENCRYPTION_KEY.length).toBeGreaterThan(0);
  });
});
