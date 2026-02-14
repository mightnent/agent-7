import type {
  BaileysInboundMessageLike,
  BaileysMediaMessageLike,
  NormalizedWhatsAppMessage,
  WhatsAppMediaAttachment,
  WhatsAppMediaKind,
} from "./whatsapp-types";
import type { WhatsAppInboundStore } from "./whatsapp-inbound.store";
import type { RateLimiter } from "./rate-limiter";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MESSAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const DEFAULT_MIME_BY_KIND: Record<WhatsAppMediaKind, string> = {
  image: "image/jpeg",
  video: "video/mp4",
  audio: "audio/ogg",
  document: "application/octet-stream",
};

const DEFAULT_FILE_BASENAME_BY_KIND: Record<WhatsAppMediaKind, string> = {
  image: "image",
  video: "video",
  audio: "audio",
  document: "document",
};

export interface InboundPersistenceMetadata {
  provider: "whatsapp";
  senderName: string | null;
  fromMe: boolean;
  timestamp: string;
  attachments: Array<{
    kind: WhatsAppMediaKind;
    mimetype: string;
    fileName: string;
    sizeBytes: number;
    caption?: string;
  }>;
}

export interface NormalizeWhatsAppMessageOptions {
  downloadMedia: (message: BaileysInboundMessageLike) => Promise<Buffer>;
}

export interface HandleInboundWhatsAppMessageOptions extends NormalizeWhatsAppMessageOptions {
  store: WhatsAppInboundStore;
  rateLimiter?: RateLimiter;
  now?: () => Date;
  sessionTtlMs?: number;
  messageTtlMs?: number;
}

export type HandleInboundWhatsAppMessageResult =
  | {
      status: "rate_limited";
      channelMessageId: string;
    }
  | {
      status: "duplicate";
      channelMessageId: string;
    }
  | {
      status: "stored";
      sessionId: string;
      messageId: string;
      normalized: NormalizedWhatsAppMessage;
    };

const normalizeTimestamp = (value: BaileysInboundMessageLike["messageTimestamp"]): Date => {
  if (typeof value === "number") {
    return new Date(value * 1000);
  }

  if (typeof value === "string") {
    const num = Number(value);
    if (!Number.isNaN(num)) {
      return new Date(num * 1000);
    }
  }

  if (typeof value === "object" && value && typeof value.toNumber === "function") {
    return new Date(value.toNumber() * 1000);
  }

  return new Date();
};

const mediaKindFromMessage = (message: NonNullable<BaileysInboundMessageLike["message"]>): {
  kind: WhatsAppMediaKind;
  media: BaileysMediaMessageLike;
} | null => {
  if (message.imageMessage) {
    return { kind: "image", media: message.imageMessage };
  }

  if (message.videoMessage) {
    return { kind: "video", media: message.videoMessage };
  }

  if (message.audioMessage) {
    return { kind: "audio", media: message.audioMessage };
  }

  if (message.documentMessage) {
    return { kind: "document", media: message.documentMessage };
  }

  return null;
};

const textFromMessage = (message: BaileysInboundMessageLike["message"] | null | undefined): string | null => {
  if (!message) {
    return null;
  }

  if (message.conversation?.trim()) {
    return message.conversation.trim();
  }

  if (message.extendedTextMessage?.text?.trim()) {
    return message.extendedTextMessage.text.trim();
  }

  if (message.imageMessage?.caption?.trim()) {
    return message.imageMessage.caption.trim();
  }

  if (message.videoMessage?.caption?.trim()) {
    return message.videoMessage.caption.trim();
  }

  if (message.documentMessage?.caption?.trim()) {
    return message.documentMessage.caption.trim();
  }

  if (message.audioMessage?.caption?.trim()) {
    return message.audioMessage.caption.trim();
  }

  return null;
};

const fileExtensionFromMimeType = (mimetype: string): string => {
  const parts = mimetype.split("/");
  if (parts.length < 2) {
    return "bin";
  }

  const extension = parts[1].split(";")[0]?.trim().toLowerCase();
  return extension || "bin";
};

const makeDefaultFileName = (kind: WhatsAppMediaKind, messageId: string, mimetype: string): string => {
  const extension = fileExtensionFromMimeType(mimetype);
  const baseName = DEFAULT_FILE_BASENAME_BY_KIND[kind];
  return `${baseName}-${messageId}.${extension}`;
};

const attachmentMetadata = (attachments: WhatsAppMediaAttachment[]): InboundPersistenceMetadata["attachments"] => {
  return attachments.map((attachment) => ({
    kind: attachment.kind,
    mimetype: attachment.mimetype,
    fileName: attachment.fileName,
    sizeBytes: attachment.sizeBytes,
    caption: attachment.caption,
  }));
};

export const normalizeWhatsAppMessage = async (
  message: BaileysInboundMessageLike,
  options: NormalizeWhatsAppMessageOptions,
): Promise<NormalizedWhatsAppMessage | null> => {
  const channelMessageId = message.key.id?.trim();
  const chatId = message.key.remoteJid?.trim();

  if (!channelMessageId || !chatId) {
    return null;
  }

  const senderId = message.key.participant?.trim() || chatId;
  const userId = message.key.participant?.trim() || chatId;
  const senderName = message.pushName?.trim() || null;
  const fromMe = Boolean(message.key.fromMe);
  const timestamp = normalizeTimestamp(message.messageTimestamp);
  const text = textFromMessage(message.message);

  const mediaDescriptor = message.message ? mediaKindFromMessage(message.message) : null;
  const attachments: WhatsAppMediaAttachment[] = [];

  if (mediaDescriptor) {
    const mimetype = mediaDescriptor.media.mimetype || DEFAULT_MIME_BY_KIND[mediaDescriptor.kind];
    const fileName = mediaDescriptor.media.fileName || makeDefaultFileName(mediaDescriptor.kind, channelMessageId, mimetype);
    const buffer = await options.downloadMedia(message);

    attachments.push({
      kind: mediaDescriptor.kind,
      mimetype,
      fileName,
      sizeBytes: buffer.length,
      caption: mediaDescriptor.media.caption,
      buffer,
    });
  }

  return {
    channelMessageId,
    chatId,
    userId,
    senderId,
    senderName,
    fromMe,
    timestamp,
    text,
    attachments,
  };
};

export const createWhatsAppInboundHandler = (options: HandleInboundWhatsAppMessageOptions) => {
  const now = options.now ?? (() => new Date());
  const sessionTtlMs = options.sessionTtlMs ?? SESSION_TTL_MS;
  const messageTtlMs = options.messageTtlMs ?? MESSAGE_TTL_MS;

  return {
    async handle(message: BaileysInboundMessageLike): Promise<HandleInboundWhatsAppMessageResult | null> {
      const normalized = await normalizeWhatsAppMessage(message, {
        downloadMedia: options.downloadMedia,
      });

      if (!normalized) {
        return null;
      }

      if (options.rateLimiter && !options.rateLimiter.allow(normalized.userId, now())) {
        return {
          status: "rate_limited",
          channelMessageId: normalized.channelMessageId,
        };
      }

      const isDuplicate = await options.store.hasMessage(normalized.channelMessageId);
      if (isDuplicate) {
        return {
          status: "duplicate",
          channelMessageId: normalized.channelMessageId,
        };
      }

      const referenceNow = now();
      const session = await options.store.upsertSession({
        channelUserId: normalized.userId,
        channelChatId: normalized.chatId,
        lastActivityAt: referenceNow,
        expiresAt: new Date(referenceNow.getTime() + sessionTtlMs),
      });

      const persisted = await options.store.persistInboundMessage({
        sessionId: session.id,
        channelMessageId: normalized.channelMessageId,
        senderId: normalized.senderId,
        contentText: normalized.text,
        contentJson: {
          provider: "whatsapp",
          senderName: normalized.senderName,
          fromMe: normalized.fromMe,
          timestamp: normalized.timestamp.toISOString(),
          attachments: attachmentMetadata(normalized.attachments),
        },
        createdAt: normalized.timestamp,
        expiresAt: new Date(referenceNow.getTime() + messageTtlMs),
      });

      if (!persisted.inserted || !persisted.id) {
        return {
          status: "duplicate",
          channelMessageId: normalized.channelMessageId,
        };
      }

      return {
        status: "stored",
        sessionId: session.id,
        messageId: persisted.id,
        normalized,
      };
    },
  };
};
