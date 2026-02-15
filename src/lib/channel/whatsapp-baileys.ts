import { downloadMediaMessage } from "@whiskeysockets/baileys/lib/Utils/messages.js";

import type { BaileysInboundMessageLike } from "./whatsapp-types";

export const downloadBaileysMediaBuffer = async (message: BaileysInboundMessageLike): Promise<Buffer> => {
  const buffer = await downloadMediaMessage(message as never, "buffer", {});

  if (!Buffer.isBuffer(buffer)) {
    throw new Error("Expected media download buffer from Baileys");
  }

  return buffer;
};
