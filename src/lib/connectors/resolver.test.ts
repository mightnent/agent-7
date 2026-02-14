import { describe, expect, it } from "vitest";

import type { ConnectorCatalog } from "./catalog";
import { InMemoryConnectorSessionMemoryStore, RuleBasedConnectorResolver } from "./resolver";

const createCatalog = (connectors: Array<{ uid: string; name: string }>): ConnectorCatalog => ({
  listConnectors: async () => connectors,
});

describe("RuleBasedConnectorResolver", () => {
  it("matches connector by catalog name", async () => {
    const resolver = new RuleBasedConnectorResolver({
      catalog: createCatalog([
        { uid: "clickup-uid", name: "ClickUp" },
        { uid: "notion-uid", name: "Notion" },
      ]),
      manualAliases: {},
      sessionMemory: new InMemoryConnectorSessionMemoryStore(),
    });

    const result = await resolver.resolve({
      sessionId: "session-1",
      message: "Can you check my tasks in click up?",
    });

    expect(result.connectorUids).toEqual(["clickup-uid"]);
    expect(result.source).toBe("catalog_name");
  });

  it("prefers manual aliases for custom connectors", async () => {
    const resolver = new RuleBasedConnectorResolver({
      catalog: createCatalog([{ uid: "clickup-uid", name: "ClickUp" }]),
      manualAliases: {
        "aether lab backlog": "custom-mcp-uid",
      },
      enabledConnectorUids: ["clickup-uid", "custom-mcp-uid"],
      sessionMemory: new InMemoryConnectorSessionMemoryStore(),
    });

    const result = await resolver.resolve({
      sessionId: "session-2",
      message: "Check aether lab backlog",
    });

    expect(result.connectorUids).toEqual(["custom-mcp-uid"]);
    expect(result.source).toBe("manual_alias");
  });

  it("reuses session memory when no explicit connector is mentioned", async () => {
    const memory = new InMemoryConnectorSessionMemoryStore();

    const resolver = new RuleBasedConnectorResolver({
      catalog: createCatalog([{ uid: "clickup-uid", name: "ClickUp" }]),
      manualAliases: {},
      sessionMemory: memory,
    });

    const first = await resolver.resolve({
      sessionId: "session-3",
      message: "Use clickup connector",
    });
    expect(first.connectorUids).toEqual(["clickup-uid"]);

    const second = await resolver.resolve({
      sessionId: "session-3",
      message: "Now check the backlog",
    });

    expect(second.connectorUids).toEqual(["clickup-uid"]);
    expect(second.source).toBe("session_memory");
  });
});
