import type { CatalogConnector, ConnectorCatalog } from "./catalog";

type ConnectorResolutionSource = "manual_alias" | "catalog_name" | "session_memory" | "none" | "ambiguous";

export interface ConnectorResolution {
  connectorUids: string[];
  confidence: number;
  reason: string;
  source: ConnectorResolutionSource;
}

export interface ConnectorResolver {
  resolve(input: { sessionId: string; message: string }): Promise<ConnectorResolution>;
}

export interface ConnectorSessionMemoryStore {
  get(sessionId: string): string[] | null;
  set(sessionId: string, connectorUids: string[]): void;
}

export class InMemoryConnectorSessionMemoryStore implements ConnectorSessionMemoryStore {
  private readonly memory = new Map<string, string[]>();

  get(sessionId: string): string[] | null {
    const value = this.memory.get(sessionId);
    if (!value || value.length === 0) {
      return null;
    }

    return [...value];
  }

  set(sessionId: string, connectorUids: string[]): void {
    const compact = [...new Set(connectorUids.map((uid) => uid.trim()).filter(Boolean))];
    if (compact.length === 0) {
      this.memory.delete(sessionId);
      return;
    }

    this.memory.set(sessionId, compact);
  }
}

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const compact = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

const aliasMatches = (alias: string, messageNormalized: string, messageCompact: string): boolean => {
  if (!alias) {
    return false;
  }

  const aliasTokens = alias.split(" ").filter(Boolean);
  if (aliasTokens.length > 1) {
    const escaped = aliasTokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
    const pattern = new RegExp(`\\b${escaped}\\b`, "i");
    if (pattern.test(messageNormalized)) {
      return true;
    }
  }

  return messageCompact.includes(alias.replace(/\s+/g, ""));
};

const buildCatalogAliases = (connectors: CatalogConnector[]): Map<string, string> => {
  const aliases = new Map<string, string>();

  for (const connector of connectors) {
    const normalizedName = normalize(connector.name);
    if (!normalizedName) {
      continue;
    }

    aliases.set(normalizedName, connector.uid);
    aliases.set(normalizedName.replace(/\s+/g, ""), connector.uid);
  }

  return aliases;
};

const parseEnabledUidSet = (
  configuredEnabledUids: string[] | null,
  connectors: CatalogConnector[],
): Set<string> => {
  if (!configuredEnabledUids || configuredEnabledUids.length === 0) {
    return new Set(connectors.map((connector) => connector.uid));
  }

  return new Set(configuredEnabledUids);
};

export class RuleBasedConnectorResolver implements ConnectorResolver {
  constructor(
    private readonly deps: {
      catalog: ConnectorCatalog;
      manualAliases: Record<string, string>;
      enabledConnectorUids?: string[];
      sessionMemory: ConnectorSessionMemoryStore;
    },
  ) {}

  async resolve(input: { sessionId: string; message: string }): Promise<ConnectorResolution> {
    const messageNormalized = normalize(input.message);
    const messageCompact = compact(input.message);

    const connectors = await this.deps.catalog.listConnectors();
    const enabledUids = parseEnabledUidSet(this.deps.enabledConnectorUids ?? null, connectors);

    const manualMatches = new Set<string>();
    for (const [rawAlias, uid] of Object.entries(this.deps.manualAliases)) {
      const normalizedAlias = normalize(rawAlias);
      if (!normalizedAlias || !enabledUids.has(uid)) {
        continue;
      }

      if (aliasMatches(normalizedAlias, messageNormalized, messageCompact)) {
        manualMatches.add(uid);
      }
    }

    if (manualMatches.size === 1) {
      const connectorUids = [...manualMatches];
      this.deps.sessionMemory.set(input.sessionId, connectorUids);
      return {
        connectorUids,
        confidence: 0.99,
        reason: "matched_manual_alias",
        source: "manual_alias",
      };
    }

    if (manualMatches.size > 1) {
      return {
        connectorUids: [],
        confidence: 0,
        reason: "ambiguous_manual_aliases",
        source: "ambiguous",
      };
    }

    const catalogAliases = buildCatalogAliases(connectors);
    const catalogMatches = new Set<string>();
    for (const [alias, uid] of catalogAliases.entries()) {
      if (!enabledUids.has(uid)) {
        continue;
      }

      if (aliasMatches(alias, messageNormalized, messageCompact)) {
        catalogMatches.add(uid);
      }
    }

    if (catalogMatches.size === 1) {
      const connectorUids = [...catalogMatches];
      this.deps.sessionMemory.set(input.sessionId, connectorUids);
      return {
        connectorUids,
        confidence: 0.9,
        reason: "matched_catalog_name",
        source: "catalog_name",
      };
    }

    if (catalogMatches.size > 1) {
      return {
        connectorUids: [],
        confidence: 0,
        reason: "ambiguous_catalog_matches",
        source: "ambiguous",
      };
    }

    const remembered = this.deps.sessionMemory.get(input.sessionId);
    if (remembered && remembered.length > 0) {
      return {
        connectorUids: remembered,
        confidence: 0.6,
        reason: "reused_session_memory",
        source: "session_memory",
      };
    }

    return {
      connectorUids: [],
      confidence: 0,
      reason: "no_connector_match",
      source: "none",
    };
  }
}
