export interface WhatsAppMediaSendInput {
  buffer: Buffer;
  mimetype: string;
  fileName: string;
  caption?: string;
}

type OutgoingTextMessage = {
  type: "text";
  jid: string;
  text: string;
};

type OutgoingMediaMessage = {
  type: "media";
  jid: string;
  media: WhatsAppMediaSendInput;
};

type OutgoingMessage = OutgoingTextMessage | OutgoingMediaMessage;

export interface WhatsAppAdapter {
  sendTextMessage(jid: string, text: string): Promise<void>;
  sendMediaMessage(jid: string, media: WhatsAppMediaSendInput): Promise<void>;
  setTyping(jid: string, isTyping: boolean): Promise<void>;
}

export interface BaileysSocketLike {
  sendMessage(jid: string, payload: unknown): Promise<unknown>;
  sendPresenceUpdate(presence: "composing" | "paused", jid: string): Promise<unknown>;
}

export interface WhatsAppBaileysAdapterOptions {
  getSocket: () => BaileysSocketLike | null;
  isConnected: () => boolean;
}

const MAX_TEXT_MESSAGE_CHARS = 3_000;

export type BaileysMediaPayload =
  | {
      image: Buffer;
      mimetype: string;
      caption?: string;
    }
  | {
      audio: Buffer;
      mimetype: string;
      caption?: string;
    }
  | {
      video: Buffer;
      mimetype: string;
      caption?: string;
    }
  | {
      document: Buffer;
      mimetype: string;
      fileName: string;
      caption?: string;
    };

export const toBaileysMediaPayload = (media: WhatsAppMediaSendInput): BaileysMediaPayload => {
  if (media.mimetype.startsWith("image/")) {
    return {
      image: media.buffer,
      mimetype: media.mimetype,
      caption: media.caption,
    };
  }

  if (media.mimetype.startsWith("audio/")) {
    return {
      audio: media.buffer,
      mimetype: media.mimetype,
      caption: media.caption,
    };
  }

  if (media.mimetype.startsWith("video/")) {
    return {
      video: media.buffer,
      mimetype: media.mimetype,
      caption: media.caption,
    };
  }

  return {
    document: media.buffer,
    mimetype: media.mimetype,
    fileName: media.fileName,
    caption: media.caption,
  };
};

const splitTextMessage = (text: string): string[] => {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < trimmed.length) {
    const remaining = trimmed.length - cursor;
    if (remaining <= MAX_TEXT_MESSAGE_CHARS) {
      chunks.push(trimmed.slice(cursor));
      break;
    }

    const window = trimmed.slice(cursor, cursor + MAX_TEXT_MESSAGE_CHARS);
    const newlineBreak = window.lastIndexOf("\n");
    const spaceBreak = window.lastIndexOf(" ");
    const splitAt = Math.max(newlineBreak, spaceBreak);

    if (splitAt <= 0) {
      chunks.push(window);
      cursor += MAX_TEXT_MESSAGE_CHARS;
      continue;
    }

    chunks.push(window.slice(0, splitAt).trimEnd());
    cursor += splitAt + 1;
  }

  return chunks.filter((chunk) => chunk.length > 0);
};

export class BaileysWhatsAppAdapter implements WhatsAppAdapter {
  private readonly outgoingQueue: OutgoingMessage[] = [];
  private flushingQueue = false;

  constructor(private readonly options: WhatsAppBaileysAdapterOptions) {}

  async sendTextMessage(jid: string, text: string): Promise<void> {
    const chunks = splitTextMessage(text);
    if (chunks.length === 0) {
      return;
    }

    for (const chunk of chunks) {
      await this.sendOrQueue({ type: "text", jid, text: chunk });
    }
  }

  async sendMediaMessage(jid: string, media: WhatsAppMediaSendInput): Promise<void> {
    await this.sendOrQueue({ type: "media", jid, media });
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    const socket = this.options.getSocket();
    if (!socket || !this.options.isConnected()) {
      return;
    }

    try {
      await socket.sendPresenceUpdate(isTyping ? "composing" : "paused", jid);
    } catch {
      // no-op by design: typing indicator should never block main flow
    }
  }

  getQueueSize(): number {
    return this.outgoingQueue.length;
  }

  async flushOutgoingQueue(): Promise<void> {
    if (this.flushingQueue || !this.options.isConnected() || this.outgoingQueue.length === 0) {
      return;
    }

    this.flushingQueue = true;
    try {
      while (this.options.isConnected() && this.outgoingQueue.length > 0) {
        const message = this.outgoingQueue.shift();
        if (!message) {
          break;
        }

        try {
          await this.dispatchMessage(message);
        } catch {
          this.outgoingQueue.unshift(message);
          break;
        }
      }
    } finally {
      this.flushingQueue = false;
    }
  }

  private async sendOrQueue(message: OutgoingMessage): Promise<void> {
    if (!this.options.isConnected()) {
      this.outgoingQueue.push(message);
      return;
    }

    try {
      await this.dispatchMessage(message);
    } catch {
      this.outgoingQueue.push(message);
    }
  }

  private async dispatchMessage(message: OutgoingMessage): Promise<void> {
    const socket = this.options.getSocket();
    if (!socket) {
      throw new Error("WhatsApp socket unavailable");
    }

    if (message.type === "text") {
      await socket.sendMessage(message.jid, { text: message.text });
      return;
    }

    await socket.sendMessage(message.jid, toBaileysMediaPayload(message.media));
  }
}
