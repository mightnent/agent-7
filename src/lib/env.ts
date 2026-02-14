import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  MANUS_API_KEY: z.string().min(1),
  MANUS_BASE_URL: z.string().url().default("https://api.manus.ai"),
  MANUS_WEBHOOK_URL: z.string().url().optional(),
  MANUS_WEBHOOK_SECRET: z.string().min(16),
  MANUS_AGENT_PROFILE: z.enum(["manus-1.6", "manus-1.6-lite", "manus-1.6-max"]).default("manus-1.6"),
  MANUS_CONNECTOR_CATALOG_URL: z
    .string()
    .url()
    .default("https://api.manus.im/connectors.v1.ConnectorsPublicService/PublicListConnectors"),
  MANUS_CONNECTOR_CATALOG_LIMIT: z.coerce.number().int().positive().max(1000).default(200),
  MANUS_CONNECTOR_CATALOG_TTL_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
  MANUS_ENABLED_CONNECTOR_UIDS: z.string().optional(),
  MANUS_MANUAL_CONNECTOR_ALIASES: z.string().optional(),
  ROUTER_LLM_PROVIDER: z.enum(["none", "openai_compatible"]).default("none"),
  ROUTER_LLM_API_KEY: z.string().optional(),
  ROUTER_LLM_MODEL: z.string().default("gpt-4.1-mini"),
  ROUTER_LLM_BASE_URL: z.string().url().default("https://api.openai.com"),
  WHATSAPP_AUTH_DIR: z.string().default("./.data/whatsapp-auth"),
  WHATSAPP_SESSION_NAME: z.string().default("default"),
  INTERNAL_CLEANUP_TOKEN: z.string().min(16),
});

export type Env = z.infer<typeof envSchema>;

export const parseEnv = (source: Record<string, string | undefined>): Env => {
  return envSchema.parse(source);
};

let cachedEnv: Env | null = null;

export const getEnv = (): Env => {
  if (cachedEnv) {
    return cachedEnv;
  }

  cachedEnv = parseEnv(process.env);
  return cachedEnv;
};

export const resetEnvCacheForTests = (): void => {
  cachedEnv = null;
};
