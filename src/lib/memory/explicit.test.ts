import { describe, expect, it } from "vitest";

import { detectExplicitMemories } from "./explicit";

describe("detectExplicitMemories", () => {
  it("extracts multiple memory candidates from a compound self-description", () => {
    const memories = detectExplicitMemories(
      "Mike, remember that I am the founder of ME TECH, a software agency in singapore. I am also a Partner in Aether-Lab, a subsidiary of Adrenalin Group. I also work in Beep and Voltality as PM for agentic commerce.",
    );

    expect(memories.length).toBeGreaterThanOrEqual(3);
    expect(memories.some((m) => m.content.toLowerCase().includes("founder"))).toBe(true);
    expect(memories.some((m) => m.content.toLowerCase().includes("partner"))).toBe(true);
    expect(memories.some((m) => m.content.toLowerCase().includes("works"))).toBe(true);
  });
});
