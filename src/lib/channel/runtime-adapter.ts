import type { WhatsAppAdapter } from "./whatsapp-adapter";

let runtimeWhatsAppAdapter: WhatsAppAdapter | null = null;

export const setRuntimeWhatsAppAdapter = (adapter: WhatsAppAdapter): void => {
  runtimeWhatsAppAdapter = adapter;
};

export const clearRuntimeWhatsAppAdapter = (): void => {
  runtimeWhatsAppAdapter = null;
};

export const getRuntimeWhatsAppAdapter = (): WhatsAppAdapter | null => {
  return runtimeWhatsAppAdapter;
};

export const createNoopWhatsAppAdapter = (): WhatsAppAdapter => ({
  async sendTextMessage() {},
  async sendMediaMessage() {},
  async setTyping() {},
});
