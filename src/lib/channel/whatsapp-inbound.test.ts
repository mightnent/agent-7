import { describe, expect, it, vi } from "vitest";

import { createWhatsAppInboundHandler, normalizeWhatsAppMessage } from "./whatsapp-inbound";
import type { BaileysInboundMessageLike } from "./whatsapp-types";
import type { WhatsAppInboundStore } from "./whatsapp-inbound.store";

const makeStore = (): WhatsAppInboundStore => ({
  hasMessage: vi.fn(),
  upsertSession: vi.fn(),
  persistInboundMessage: vi.fn(),
});

const baseMessage: BaileysInboundMessageLike = {
  key: {
    id: "msg-1",
    remoteJid: "15551234567@s.whatsapp.net",
    fromMe: false,
  },
  message: {
    conversation: "hello from whatsapp",
  },
  messageTimestamp: 1_700_000_000,
  pushName: "Mike",
};

describe("normalizeWhatsAppMessage", () => {
  it("extracts text from conversation", async () => {
    const normalized = await normalizeWhatsAppMessage(baseMessage, {
      downloadMedia: vi.fn(),
    });

    expect(normalized?.text).toBe("hello from whatsapp");
    expect(normalized?.attachments).toHaveLength(0);
    expect(normalized?.channelMessageId).toBe("msg-1");
  });

  it("downloads media and includes attachment metadata", async () => {
    const message: BaileysInboundMessageLike = {
      ...baseMessage,
      message: {
        imageMessage: {
          caption: "check this",
          mimetype: "image/png",
          fileName: "image.png",
        },
      },
    };

    const normalized = await normalizeWhatsAppMessage(message, {
      downloadMedia: vi.fn().mockResolvedValue(Buffer.from("img")),
    });

    expect(normalized?.text).toBe("check this");
    expect(normalized?.attachments).toHaveLength(1);
    expect(normalized?.attachments[0]).toMatchObject({
      kind: "image",
      mimetype: "image/png",
      fileName: "image.png",
      sizeBytes: 3,
      caption: "check this",
    });
  });

  it("returns null when message id or chat id is missing", async () => {
    const normalized = await normalizeWhatsAppMessage(
      {
        key: {
          id: null,
          remoteJid: null,
        },
        message: {
          conversation: "hello",
        },
      },
      {
        downloadMedia: vi.fn(),
      },
    );

    expect(normalized).toBeNull();
  });
});

describe("createWhatsAppInboundHandler", () => {
  it("returns rate_limited when limiter denies sender", async () => {
    const store = makeStore();
    const handler = createWhatsAppInboundHandler({
      store,
      downloadMedia: vi.fn(),
      rateLimiter: {
        allow: vi.fn().mockReturnValue(false),
      },
    });

    const result = await handler.handle(baseMessage);

    expect(result).toEqual({
      status: "rate_limited",
      channelMessageId: "msg-1",
    });
    expect(store.hasMessage).not.toHaveBeenCalled();
  });

  it("short-circuits duplicate inbound messages", async () => {
    const store = makeStore();
    vi.mocked(store.hasMessage).mockResolvedValue(true);

    const handler = createWhatsAppInboundHandler({
      store,
      downloadMedia: vi.fn(),
    });

    const result = await handler.handle(baseMessage);

    expect(result).toEqual({
      status: "duplicate",
      channelMessageId: "msg-1",
    });
    expect(store.upsertSession).not.toHaveBeenCalled();
    expect(store.persistInboundMessage).not.toHaveBeenCalled();
  });

  it("upserts session and persists inbound messages", async () => {
    const store = makeStore();
    const now = new Date("2026-02-13T00:00:00.000Z");

    vi.mocked(store.hasMessage).mockResolvedValue(false);
    vi.mocked(store.upsertSession).mockResolvedValue({ id: "session-1" });
    vi.mocked(store.persistInboundMessage).mockResolvedValue({
      inserted: true,
      id: "message-1",
    });

    const handler = createWhatsAppInboundHandler({
      store,
      downloadMedia: vi.fn(),
      now: () => now,
    });

    const result = await handler.handle(baseMessage);

    expect(result).toMatchObject({
      status: "stored",
      sessionId: "session-1",
      messageId: "message-1",
    });

    expect(store.upsertSession).toHaveBeenCalledWith(
      expect.objectContaining({
        channelUserId: "15551234567@s.whatsapp.net",
        channelChatId: "15551234567@s.whatsapp.net",
      }),
    );

    expect(store.persistInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        channelMessageId: "msg-1",
        senderId: "15551234567@s.whatsapp.net",
        contentText: "hello from whatsapp",
      }),
    );
  });

  it("treats race-condition conflicts as duplicates", async () => {
    const store = makeStore();

    vi.mocked(store.hasMessage).mockResolvedValue(false);
    vi.mocked(store.upsertSession).mockResolvedValue({ id: "session-1" });
    vi.mocked(store.persistInboundMessage).mockResolvedValue({
      inserted: false,
      id: null,
    });

    const handler = createWhatsAppInboundHandler({
      store,
      downloadMedia: vi.fn(),
    });

    const result = await handler.handle(baseMessage);

    expect(result).toEqual({
      status: "duplicate",
      channelMessageId: "msg-1",
    });
  });
});
