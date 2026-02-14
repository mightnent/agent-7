import { getEnv } from "@/lib/env";

import { CachedConnectorCatalog, ManusPublicConnectorCatalog } from "./catalog";
import {
  InMemoryConnectorSessionMemoryStore,
  RuleBasedConnectorResolver,
  type ConnectorResolver,
  type ConnectorSessionMemoryStore,
} from "./resolver";

const parseCsv = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const parseManualAliases = (value: string | undefined): Record<string, string> => {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const aliases: Record<string, string> = {};
    for (const [key, rawValue] of Object.entries(parsed)) {
      if (typeof rawValue !== "string") {
        continue;
      }

      const alias = key.trim();
      const uid = rawValue.trim();
      if (!alias || !uid) {
        continue;
      }

      aliases[alias] = uid;
    }

    return aliases;
  } catch {
    return {};
  }
};

let connectorMemorySingleton: ConnectorSessionMemoryStore | null = null;

const getConnectorMemoryStore = (): ConnectorSessionMemoryStore => {
  if (!connectorMemorySingleton) {
    connectorMemorySingleton = new InMemoryConnectorSessionMemoryStore();
  }

  return connectorMemorySingleton;
};

export const createConnectorResolverFromEnv = (options?: {
  fetchImpl?: typeof fetch;
  memoryStore?: ConnectorSessionMemoryStore;
}): ConnectorResolver => {
  const env = getEnv();
  const source = new ManusPublicConnectorCatalog({
    endpoint: env.MANUS_CONNECTOR_CATALOG_URL,
    limit: env.MANUS_CONNECTOR_CATALOG_LIMIT,
    fetchImpl: options?.fetchImpl,
  });

  const catalog = new CachedConnectorCatalog(source, env.MANUS_CONNECTOR_CATALOG_TTL_MS);

  const enabledUids = parseCsv(env.MANUS_ENABLED_CONNECTOR_UIDS);

  return new RuleBasedConnectorResolver({
    catalog,
    manualAliases: parseManualAliases(env.MANUS_MANUAL_CONNECTOR_ALIASES),
    enabledConnectorUids: enabledUids.length > 0 ? enabledUids : undefined,
    sessionMemory: options?.memoryStore ?? getConnectorMemoryStore(),
  });
};
