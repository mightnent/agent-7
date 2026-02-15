import { z } from "zod";

const isValidEncryptionKeyFormat = (value: string): boolean => {
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return true;
  }

  try {
    const decoded = Buffer.from(trimmed, "base64");
    return decoded.length === 32;
  } catch {
    return false;
  }
};

const bootstrapEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  DB_ENCRYPTION_KEY: z
    .string()
    .refine(
      isValidEncryptionKeyFormat,
      "DB_ENCRYPTION_KEY must be 32 bytes encoded as 64-char hex or base64",
    ),
});

export type BootstrapEnv = z.infer<typeof bootstrapEnvSchema>;

let cachedBootstrapEnv: BootstrapEnv | null = null;

export const parseBootstrapEnv = (source: Record<string, string | undefined>): BootstrapEnv => {
  return bootstrapEnvSchema.parse(source);
};

export const getBootstrapEnv = (): BootstrapEnv => {
  if (cachedBootstrapEnv) {
    return cachedBootstrapEnv;
  }

  cachedBootstrapEnv = parseBootstrapEnv(process.env);
  return cachedBootstrapEnv;
};

export const resetBootstrapEnvCacheForTests = (): void => {
  cachedBootstrapEnv = null;
};
