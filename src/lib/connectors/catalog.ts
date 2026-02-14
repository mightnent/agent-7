export interface CatalogConnector {
  uid: string;
  name: string;
}

export interface ConnectorCatalog {
  listConnectors(): Promise<CatalogConnector[]>;
}

interface PublicListConnectorsResponse {
  connectors?: Array<{
    uid?: string;
    name?: string;
  }>;
}

export class ManusPublicConnectorCatalog implements ConnectorCatalog {
  constructor(
    private readonly config: {
      endpoint: string;
      limit: number;
      fetchImpl?: typeof fetch;
      timeoutMs?: number;
    },
  ) {}

  async listConnectors(): Promise<CatalogConnector[]> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 8_000);

    try {
      const response = await fetchImpl(this.config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          offset: 0,
          limit: this.config.limit,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return [];
      }

      const payload = (await response.json()) as PublicListConnectorsResponse;
      if (!Array.isArray(payload.connectors)) {
        return [];
      }

      const dedupe = new Map<string, CatalogConnector>();
      for (const connector of payload.connectors) {
        const uid = connector.uid?.trim();
        const name = connector.name?.trim();
        if (!uid || !name) {
          continue;
        }

        dedupe.set(uid, { uid, name });
      }

      return [...dedupe.values()];
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class CachedConnectorCatalog implements ConnectorCatalog {
  private cache: {
    fetchedAt: number;
    connectors: CatalogConnector[];
  } | null = null;

  constructor(
    private readonly source: ConnectorCatalog,
    private readonly ttlMs: number,
  ) {}

  async listConnectors(): Promise<CatalogConnector[]> {
    const now = Date.now();

    if (this.cache && now - this.cache.fetchedAt < this.ttlMs) {
      return this.cache.connectors;
    }

    const connectors = await this.source.listConnectors();

    if (connectors.length > 0) {
      this.cache = {
        fetchedAt: now,
        connectors,
      };
      return connectors;
    }

    return this.cache?.connectors ?? [];
  }
}
