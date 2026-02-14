import { describe, expect, it } from "vitest";

import { canonicalizeJid, shouldProcessMessage } from "./bot-config";
import type { BotConfig } from "./bot-config";

const config: BotConfig = {
  assistantName: "Mike",
  mainChannel: {
    jid: "6582521181@s.whatsapp.net",
    name: "Self Chat",
    requiresTrigger: true,
  },
  registeredChats: {
    "6582521181@s.whatsapp.net": {
      name: "Self Chat",
      requiresTrigger: true,
      isMain: true,
    },
    "120363425410637781@g.us": {
      name: "Aether Lab 2.0",
      requiresTrigger: true,
      isMain: false,
    },
  },
};

describe("canonicalizeJid", () => {
  it("strips device suffix from phone-number JIDs", () => {
    expect(canonicalizeJid("6582521181:97@s.whatsapp.net")).toBe("6582521181@s.whatsapp.net");
  });

  it("strips device suffix from LID JIDs", () => {
    expect(canonicalizeJid("94523774529590:97@lid")).toBe("94523774529590@lid");
  });

  it("leaves other JIDs unchanged", () => {
    expect(canonicalizeJid("120363425410637781@g.us")).toBe("120363425410637781@g.us");
  });
});

describe("shouldProcessMessage", () => {
  it("matches self-chat when inbound JID includes a device suffix", () => {
    const result = shouldProcessMessage(config, {
      chatJid: "6582521181:97@s.whatsapp.net",
      text: "Mike can you summarize this",
      fromMe: true,
    });

    expect(result).toEqual({
      process: true,
      text: "can you summarize this",
    });
  });

  it("skips self-chat fromMe messages without the name trigger", () => {
    const result = shouldProcessMessage(config, {
      chatJid: "6582521181:97@s.whatsapp.net",
      text: "can you summarize this",
      fromMe: true,
    });

    expect(result).toEqual({ process: false });
  });
});
