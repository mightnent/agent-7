import makeWASocket from "@whiskeysockets/baileys";
import { makeCacheableSignalKeyStore } from "@whiskeysockets/baileys/lib/Utils/auth-utils.js";
import type { ConnectionState } from "@whiskeysockets/baileys/lib/Types/State.js";
import pino from "pino";

import { DEFAULT_WORKSPACE_ID } from "@/db/schema";

import { updateWhatsAppChannelConnection } from "./workspace-channel-service";
import { clearWorkspaceAuthState, loadWorkspaceAuthState } from "./auth-state";

const logger = pino({ level: "info" });
const LOGGED_OUT_STATUS_CODE = 401;
const RESTART_REQUIRED_STATUS_CODE = 515;

export interface PairingSnapshot {
  status: "idle" | "pairing" | "connected" | "error";
  qr: string | null;
  phoneNumber: string | null;
  displayName: string | null;
  backend: "db" | "filesystem" | null;
  error: string | null;
  updatedAt: string;
}

type PairingListener = (snapshot: PairingSnapshot) => void;

interface PairingState {
  socket: ReturnType<typeof makeWASocket> | null;
  snapshot: PairingSnapshot;
  listeners: Set<PairingListener>;
  isStarting: boolean;
  connectionHandler: ((update: Partial<ConnectionState>) => void) | null;
  credsHandler: (() => Promise<void>) | null;
  reconnectTimer: NodeJS.Timeout | null;
}

declare global {
  var __manus_whatsapp_pairing__: PairingState | undefined;
}

const getState = (): PairingState => {
  if (!globalThis.__manus_whatsapp_pairing__) {
    globalThis.__manus_whatsapp_pairing__ = {
      socket: null,
      snapshot: {
        status: "idle",
        qr: null,
        phoneNumber: null,
        displayName: null,
        backend: null,
        error: null,
        updatedAt: new Date().toISOString(),
      },
      listeners: new Set(),
      isStarting: false,
      connectionHandler: null,
      credsHandler: null,
      reconnectTimer: null,
    };
  }

  return globalThis.__manus_whatsapp_pairing__;
};

const publish = (patch: Partial<PairingSnapshot>): void => {
  const state = getState();
  state.snapshot = {
    ...state.snapshot,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  for (const listener of state.listeners) {
    listener(state.snapshot);
  }
};

export const getPairingSnapshot = (): PairingSnapshot => {
  return getState().snapshot;
};

export const subscribePairing = (listener: PairingListener): (() => void) => {
  const state = getState();
  state.listeners.add(listener);
  listener(state.snapshot);
  return () => {
    state.listeners.delete(listener);
  };
};

export const getPairingSocket = (): ReturnType<typeof makeWASocket> | null => {
  return getState().socket;
};

const clearReconnectTimer = (state: PairingState): void => {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
};

const teardownSocket = async (state: PairingState, logout: boolean): Promise<void> => {
  clearReconnectTimer(state);

  if (!state.socket) {
    state.connectionHandler = null;
    state.credsHandler = null;
    return;
  }

  if (state.credsHandler) {
    state.socket.ev.off("creds.update", state.credsHandler);
  }
  if (state.connectionHandler) {
    state.socket.ev.off("connection.update", state.connectionHandler);
  }

  if (logout) {
    try {
      await state.socket.logout();
    } catch {
      // no-op
    }
  }

  state.socket.end(undefined);
  state.socket = null;
  state.connectionHandler = null;
  state.credsHandler = null;
};

export const disconnectPairing = async (): Promise<void> => {
  const state = getState();
  await teardownSocket(state, true);

  state.isStarting = false;
  publish({
    status: "idle",
    qr: null,
    error: null,
  });

  await updateWhatsAppChannelConnection({
    status: "disconnected",
    phoneNumber: null,
    displayName: null,
    connectedAt: null,
  }).catch(() => {
    // Keep API resilient even if DB update fails.
  });
};

export const startPairing = async (input: {
  workspaceId?: string;
  sessionName: string;
  authDir: string;
}): Promise<PairingSnapshot> => {
  const state = getState();
  if (state.isStarting || state.snapshot.status === "pairing") {
    return state.snapshot;
  }

  if (state.socket) {
    await teardownSocket(state, true);
  }

  state.isStarting = true;
  publish({
    status: "pairing",
    qr: null,
    error: null,
  });

  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;

  try {
    let auth = await loadWorkspaceAuthState({
      workspaceId,
      sessionName: input.sessionName,
      authDir: input.authDir,
    });
    let resetAttemptedAfterLogout = false;

    const connect = async (): Promise<void> => {
      await teardownSocket(state, false);

      const socket = makeWASocket({
        auth: {
          creds: auth.state.creds,
          keys: makeCacheableSignalKeyStore(auth.state.keys, logger),
        },
        logger,
      });

      state.socket = socket;

      state.credsHandler = auth.saveCreds;
      socket.ev.on("creds.update", state.credsHandler);

      state.connectionHandler = (update: Partial<ConnectionState>) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          publish({
            status: "pairing",
            qr,
            backend: auth.backend,
            error: null,
          });
        }

        if (connection === "open") {
          const me = auth.state.creds.me;
          publish({
            status: "connected",
            qr: null,
            phoneNumber: me?.id ?? null,
            displayName: me?.name ?? null,
            backend: auth.backend,
            error: null,
          });

          void updateWhatsAppChannelConnection({
            workspaceId,
            status: "connected",
            phoneNumber: me?.id ?? null,
            displayName: me?.name ?? null,
            connectedAt: new Date(),
          });
        }

        if (connection === "close") {
          const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output
            ?.statusCode;

          if (statusCode === LOGGED_OUT_STATUS_CODE) {
            if (!resetAttemptedAfterLogout) {
              resetAttemptedAfterLogout = true;
              publish({
                status: "pairing",
                qr: null,
                error: "Session expired. Resetting credentials and requesting a new QR...",
              });
              clearReconnectTimer(state);
              state.reconnectTimer = setTimeout(() => {
                void (async () => {
                  try {
                    await clearWorkspaceAuthState({
                      workspaceId,
                      sessionName: input.sessionName,
                      authDir: input.authDir,
                    });
                    auth = await loadWorkspaceAuthState({
                      workspaceId,
                      sessionName: input.sessionName,
                      authDir: input.authDir,
                    });
                    await connect();
                  } catch (error) {
                    const message =
                      error instanceof Error ? error.message : "Failed to reset credentials for pairing";
                    publish({
                      status: "error",
                      qr: null,
                      error: message,
                    });
                  }
                })();
              }, 800);
              return;
            }

            publish({
              status: "error",
              qr: null,
              error: "Logged out. Please pair again.",
            });
            return;
          }

          if (statusCode === RESTART_REQUIRED_STATUS_CODE) {
            publish({
              status: "pairing",
              qr: null,
              error: "Pairing complete. Restarting connection...",
            });
            clearReconnectTimer(state);
            state.reconnectTimer = setTimeout(() => {
              void connect();
            }, 800);
            return;
          }

          publish({
            status: "idle",
            qr: null,
            error: null,
          });
        }
      };
      socket.ev.on("connection.update", state.connectionHandler);
    };

    await connect();

    return state.snapshot;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start WhatsApp pairing";
    publish({
      status: "error",
      qr: null,
      error: message,
    });
    return state.snapshot;
  } finally {
    state.isStarting = false;
  }
};
