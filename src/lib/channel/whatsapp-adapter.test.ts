import { describe, expect, it, vi } from "vitest";

import { BaileysWhatsAppAdapter, toBaileysMediaPayload } from "./whatsapp-adapter";

describe("toBaileysMediaPayload", () => {
  const buffer = Buffer.from("payload");

  it("maps image media", () => {
    const payload = toBaileysMediaPayload({
      buffer,
      mimetype: "image/png",
      fileName: "x.png",
      caption: "chart",
    });

    expect(payload).toEqual({
      image: buffer,
      mimetype: "image/png",
      caption: "chart",
    });
  });

  it("maps audio media", () => {
    const payload = toBaileysMediaPayload({
      buffer,
      mimetype: "audio/mp4",
      fileName: "voice.m4a",
    });

    expect(payload).toEqual({
      audio: buffer,
      mimetype: "audio/mp4",
      caption: undefined,
    });
  });

  it("maps video media", () => {
    const payload = toBaileysMediaPayload({
      buffer,
      mimetype: "video/mp4",
      fileName: "clip.mp4",
      caption: "clip",
    });

    expect(payload).toEqual({
      video: buffer,
      mimetype: "video/mp4",
      caption: "clip",
    });
  });

  it("maps non-av media to document", () => {
    const payload = toBaileysMediaPayload({
      buffer,
      mimetype: "application/pdf",
      fileName: "file.pdf",
    });

    expect(payload).toEqual({
      document: buffer,
      mimetype: "application/pdf",
      fileName: "file.pdf",
      caption: undefined,
    });
  });
});

describe("BaileysWhatsAppAdapter", () => {
  it("queues outbound messages while disconnected and flushes after reconnect", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const sendPresenceUpdate = vi.fn().mockResolvedValue(undefined);
    const socket = {
      sendMessage,
      sendPresenceUpdate,
    };

    let connected = false;

    const adapter = new BaileysWhatsAppAdapter({
      getSocket: () => socket,
      isConnected: () => connected,
    });

    await adapter.sendTextMessage("123@s.whatsapp.net", "hello");

    expect(adapter.getQueueSize()).toBe(1);
    expect(sendMessage).not.toHaveBeenCalled();

    connected = true;
    await adapter.flushOutgoingQueue();

    expect(adapter.getQueueSize()).toBe(0);
    expect(sendMessage).toHaveBeenCalledWith("123@s.whatsapp.net", { text: "hello" });
  });

  it("requeues failed sends and retries in next flush", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(undefined);

    const adapter = new BaileysWhatsAppAdapter({
      getSocket: () => ({
        sendMessage,
        sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
      }),
      isConnected: () => true,
    });

    await adapter.sendTextMessage("123@s.whatsapp.net", "hello");
    expect(adapter.getQueueSize()).toBe(1);

    await adapter.flushOutgoingQueue();

    expect(adapter.getQueueSize()).toBe(0);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("sends typing updates only when connected", async () => {
    const sendPresenceUpdate = vi.fn().mockResolvedValue(undefined);

    const adapter = new BaileysWhatsAppAdapter({
      getSocket: () => ({
        sendMessage: vi.fn().mockResolvedValue(undefined),
        sendPresenceUpdate,
      }),
      isConnected: () => true,
    });

    await adapter.setTyping("123@s.whatsapp.net", true);
    await adapter.setTyping("123@s.whatsapp.net", false);

    expect(sendPresenceUpdate).toHaveBeenCalledWith("composing", "123@s.whatsapp.net");
    expect(sendPresenceUpdate).toHaveBeenCalledWith("paused", "123@s.whatsapp.net");
  });

  it("splits oversized text into multiple WhatsApp messages", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    const adapter = new BaileysWhatsAppAdapter({
      getSocket: () => ({
        sendMessage,
        sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
      }),
      isConnected: () => true,
    });

    const longText = `${"a".repeat(2500)} ${"b".repeat(2500)}`;
    await adapter.sendTextMessage("123@s.whatsapp.net", longText);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    const firstPayload = vi.mocked(sendMessage).mock.calls[0]?.[1] as { text: string };
    const secondPayload = vi.mocked(sendMessage).mock.calls[1]?.[1] as { text: string };
    expect(firstPayload.text.length).toBeLessThanOrEqual(3000);
    expect(secondPayload.text.length).toBeLessThanOrEqual(3000);
  });
});
