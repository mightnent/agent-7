export type SettingsCategory = "manus" | "router" | "connectors" | "internal" | "whatsapp";

export interface SettingDefinition {
  category: SettingsCategory;
  key: string;
  envVar: string;
  sensitive: boolean;
}

export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  "manus",
  "router",
  "connectors",
  "internal",
  "whatsapp",
] as const;

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  { category: "manus", key: "api_key", envVar: "MANUS_API_KEY", sensitive: true },
  { category: "manus", key: "base_url", envVar: "MANUS_BASE_URL", sensitive: false },
  { category: "manus", key: "webhook_secret", envVar: "MANUS_WEBHOOK_SECRET", sensitive: true },
  { category: "manus", key: "webhook_url", envVar: "MANUS_WEBHOOK_URL", sensitive: false },
  { category: "manus", key: "agent_profile", envVar: "MANUS_AGENT_PROFILE", sensitive: false },
  { category: "router", key: "llm_provider", envVar: "ROUTER_LLM_PROVIDER", sensitive: false },
  { category: "router", key: "llm_api_key", envVar: "ROUTER_LLM_API_KEY", sensitive: true },
  { category: "router", key: "llm_model", envVar: "ROUTER_LLM_MODEL", sensitive: false },
  { category: "router", key: "llm_base_url", envVar: "ROUTER_LLM_BASE_URL", sensitive: false },
  { category: "connectors", key: "catalog_url", envVar: "MANUS_CONNECTOR_CATALOG_URL", sensitive: false },
  { category: "connectors", key: "catalog_limit", envVar: "MANUS_CONNECTOR_CATALOG_LIMIT", sensitive: false },
  { category: "connectors", key: "catalog_ttl_ms", envVar: "MANUS_CONNECTOR_CATALOG_TTL_MS", sensitive: false },
  { category: "connectors", key: "enabled_uids", envVar: "MANUS_ENABLED_CONNECTOR_UIDS", sensitive: false },
  {
    category: "connectors",
    key: "manual_aliases",
    envVar: "MANUS_MANUAL_CONNECTOR_ALIASES",
    sensitive: false,
  },
  { category: "internal", key: "cleanup_token", envVar: "INTERNAL_CLEANUP_TOKEN", sensitive: true },
  { category: "whatsapp", key: "auth_dir", envVar: "WHATSAPP_AUTH_DIR", sensitive: false },
  { category: "whatsapp", key: "session_name", envVar: "WHATSAPP_SESSION_NAME", sensitive: false },
] as const;

const definitionMap = new Map<string, SettingDefinition>();
for (const definition of SETTING_DEFINITIONS) {
  definitionMap.set(`${definition.category}:${definition.key}`, definition);
}

export const getSettingDefinition = (
  category: string,
  key: string,
): SettingDefinition | undefined => {
  return definitionMap.get(`${category}:${key}`);
};

export const getSettingDefinitionsByCategory = (
  category: SettingsCategory,
): readonly SettingDefinition[] => {
  return SETTING_DEFINITIONS.filter((definition) => definition.category === category);
};
