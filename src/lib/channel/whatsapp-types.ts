export type WhatsAppMediaKind = "image" | "video" | "audio" | "document";

export interface WhatsAppMediaAttachment {
  kind: WhatsAppMediaKind;
  mimetype: string;
  fileName: string;
  sizeBytes: number;
  caption?: string;
  buffer: Buffer;
}

export interface NormalizedWhatsAppMessage {
  channelMessageId: string;
  chatId: string;
  userId: string;
  senderId: string;
  senderName: string | null;
  fromMe: boolean;
  timestamp: Date;
  text: string | null;
  attachments: WhatsAppMediaAttachment[];
}

export interface BaileysMediaMessageLike {
  caption?: string;
  mimetype?: string;
  fileName?: string;
}

export interface BaileysMessageContentLike {
  conversation?: string;
  extendedTextMessage?: { text?: string };
  imageMessage?: BaileysMediaMessageLike;
  videoMessage?: BaileysMediaMessageLike;
  audioMessage?: BaileysMediaMessageLike;
  documentMessage?: BaileysMediaMessageLike;
}

export interface BaileysInboundMessageLike {
  key: {
    id?: string | null;
    remoteJid?: string | null;
    participant?: string | null;
    fromMe?: boolean | null;
  };
  message?: BaileysMessageContentLike | null;
  messageTimestamp?: number | string | { toNumber?: () => number };
  pushName?: string | null;
}
