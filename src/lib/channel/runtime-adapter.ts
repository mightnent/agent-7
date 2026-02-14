import type { WhatsAppAdapter } from "./whatsapp-adapter";

const RUNTIME_ADAPTER_KEY = "__manus_runtime_whatsapp_adapter__";

type GlobalWithRuntimeAdapter = typeof globalThis & {
  [RUNTIME_ADAPTER_KEY]?: WhatsAppAdapter | null;
};

const runtimeStore = (): GlobalWithRuntimeAdapter => globalThis as GlobalWithRuntimeAdapter;

export const setRuntimeWhatsAppAdapter = (adapter: WhatsAppAdapter): void => {
  runtimeStore()[RUNTIME_ADAPTER_KEY] = adapter;
};

export const clearRuntimeWhatsAppAdapter = (): void => {
  runtimeStore()[RUNTIME_ADAPTER_KEY] = null;
};

export const getRuntimeWhatsAppAdapter = (): WhatsAppAdapter | null => {
  return runtimeStore()[RUNTIME_ADAPTER_KEY] ?? null;
};

export const createNoopWhatsAppAdapter = (): WhatsAppAdapter => ({
  async sendTextMessage() {},
  async sendMediaMessage() {},
  async setTyping() {},
});
