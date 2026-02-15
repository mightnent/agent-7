import { z } from "zod";

import { DEFAULT_WORKSPACE_ID } from "@/db/schema";

const ENV_CACHE_TTL_MS = 30_000;

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  MANUS_API_KEY: z.string().default(""),
  MANUS_BASE_URL: z.string().url().default("https://api.manus.ai"),
  MANUS_WEBHOOK_URL: z.string().url().optional(),
  MANUS_WEBHOOK_SECRET: z.string().default(""),
  MANUS_AGENT_PROFILE: z.enum(["manus-1.6", "manus-1.6-lite", "manus-1.6-max"]).default("manus-1.6"),
  MANUS_CONNECTOR_CATALOG_URL: z
    .string()
    .url()
    .default("https://api.manus.im/connectors.v1.ConnectorsPublicService/PublicListConnectors"),
  MANUS_CONNECTOR_CATALOG_LIMIT: z.coerce.number().int().positive().max(1000).default(200),
  MANUS_CONNECTOR_CATALOG_TTL_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
  MANUS_ENABLED_CONNECTOR_UUIDS: z.string().optional(),
  MANUS_ENABLED_CONNECTOR_UIDS: z.string().optional(),
  MANUS_MANUAL_CONNECTOR_ALIASES: z.string().optional(),
  ROUTER_LLM_PROVIDER: z.enum(["none", "openai_compatible"]).default("none"),
  ROUTER_LLM_API_KEY: z.string().optional(),
  ROUTER_LLM_MODEL: z.string().default("gpt-4.1-mini"),
  ROUTER_LLM_BASE_URL: z.string().url().default("https://api.openai.com"),
  WHATSAPP_AUTH_DIR: z.string().default("./.data/whatsapp-auth"),
  WHATSAPP_SESSION_NAME: z.string().default("default"),
  MOCK_TOKEN: z.string().default(""),
  INTERNAL_CLEANUP_TOKEN: z.string().default(""),
});

export type Env = z.infer<typeof envSchema>;

type EnvCacheEntry = {
  value: Env;
  expiresAt: number;
};

const workspaceCache = new Map<string, EnvCacheEntry>();

const normalizeOptionalString = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizePositiveNumberString = (value: string | undefined): string | undefined => {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return undefined;
  }

  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }

  return normalized;
};

export const parseEnv = (source: Record<string, string | undefined>): Env => {
  const normalized = {
    ...source,
    MOCK_TOKEN: source.MOCK_TOKEN ?? source.INTERNAL_CLEANUP_TOKEN,
    MANUS_ENABLED_CONNECTOR_UUIDS:
      source.MANUS_ENABLED_CONNECTOR_UUIDS ?? source.MANUS_ENABLED_CONNECTOR_UIDS,
    MANUS_CONNECTOR_CATALOG_URL: normalizeOptionalString(source.MANUS_CONNECTOR_CATALOG_URL),
    MANUS_CONNECTOR_CATALOG_LIMIT: normalizePositiveNumberString(source.MANUS_CONNECTOR_CATALOG_LIMIT),
    MANUS_CONNECTOR_CATALOG_TTL_MS: normalizePositiveNumberString(source.MANUS_CONNECTOR_CATALOG_TTL_MS),
  };
  return envSchema.parse(normalized);
};

const readWorkspaceSettingsEnvMap = async (
  workspaceId: string,
): Promise<Record<string, string>> => {
  if (process.env.NODE_ENV === "test") {
    return {};
  }

  const { settingsService } = await import("./config/settings-service");
  const categories = ["manus", "router", "connectors", "internal", "whatsapp"] as const;
  const entries = await Promise.all(
    categories.map(async (category) => {
      const values = await settingsService.getCategory(workspaceId, category);
      return Object.entries(values);
    }),
  );

  return Object.fromEntries(entries.flat());
};

export const getEnv = async (workspaceId = DEFAULT_WORKSPACE_ID): Promise<Env> => {
  const cached = workspaceCache.get(workspaceId);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const workspaceEnv = await readWorkspaceSettingsEnvMap(workspaceId);
  const parsed = parseEnv({
    ...process.env,
    ...workspaceEnv,
  });

  workspaceCache.set(workspaceId, {
    value: parsed,
    expiresAt: now + ENV_CACHE_TTL_MS,
  });

  return parsed;
};

export const resetEnvCacheForTests = (): void => {
  workspaceCache.clear();
};
