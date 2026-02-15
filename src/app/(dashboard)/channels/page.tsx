"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import { CircleHelp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface PairingState {
  status: "idle" | "pairing" | "connected" | "error";
  qr: string | null;
  error: string | null;
  backend: "db" | "filesystem" | null;
  updatedAt: string;
}

interface ConnectionState {
  status: string;
  phoneNumber: string | null;
  displayName: string | null;
  connectedAt: string | null;
}

interface GroupItem {
  jid: string;
  name: string;
}

interface ConfigChat {
  name: string;
  requiresTrigger: boolean;
  isMain: boolean;
}

interface BotConfig {
  assistantName: string;
  mainChannel: { jid: string; name: string; requiresTrigger: boolean };
  registeredChats: Record<string, ConfigChat>;
}

const SELF_CHAT_SUFFIX = "@s.whatsapp.net";

const normalizePhoneDigits = (value: string): string => {
  return value.replace(/\D+/g, "");
};

const phoneFromJid = (jid: string): string => {
  return jid.split("@")[0]?.split(":")[0] ?? "";
};

const tryReadJson = async <T,>(response: Response): Promise<T | null> => {
  const raw = await response.text();
  if (!raw.trim()) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export default function ChannelsPage() {
  const [loading, setLoading] = useState(true);
  const [pairing, setPairing] = useState<PairingState | null>(null);
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [registeredChats, setRegisteredChats] = useState<Record<string, ConfigChat>>({});

  const [assistantName, setAssistantName] = useState("Manus");
  const [mainChannelMode, setMainChannelMode] = useState<"self" | "group">("self");
  const [selfChatNumber, setSelfChatNumber] = useState("");
  const [mainGroupJid, setMainGroupJid] = useState("");
  const [selectedGroups, setSelectedGroups] = useState<Record<string, boolean>>({});
  const [showGroupEditor, setShowGroupEditor] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configMessage, setConfigMessage] = useState<string | null>(null);

  const loadStatus = async (): Promise<void> => {
    const response = await fetch("/api/channels/whatsapp/status");
    const payload = await tryReadJson<{
      pairing: PairingState;
      connection: ConnectionState;
      config: BotConfig | null;
    }>(response);

    if (!response.ok || !payload) {
      return;
    }

    setPairing(payload.pairing);
    setConnection(payload.connection);
    if (payload.config) {
      setAssistantName(payload.config.assistantName);
      setRegisteredChats(payload.config.registeredChats);

      if (payload.config.mainChannel.jid.endsWith(SELF_CHAT_SUFFIX)) {
        setMainChannelMode("self");
        setSelfChatNumber(phoneFromJid(payload.config.mainChannel.jid));
      } else {
        setMainChannelMode("group");
        setMainGroupJid(payload.config.mainChannel.jid);
      }

      const nextSelected: Record<string, boolean> = {};
      for (const [jid, chat] of Object.entries(payload.config.registeredChats)) {
        if (!chat.isMain) {
          nextSelected[jid] = true;
        }
      }
      setSelectedGroups(nextSelected);
    } else {
      setRegisteredChats({});
      setMainChannelMode("self");
      setMainGroupJid("");
    }
  };

  useEffect(() => {
    let mounted = true;
    void loadStatus().finally(() => {
      if (mounted) {
        setLoading(false);
      }
    });
    void loadGroups();

    const eventSource = new EventSource("/api/channels/whatsapp/pair/stream");
    eventSource.addEventListener("pairing", (event) => {
      try {
        const message = event as MessageEvent<string>;
        const payload = JSON.parse(message.data) as PairingState;
        if (mounted) {
          setPairing(payload);
        }
      } catch {
        // Ignore malformed SSE frames and keep prior UI state.
      }
    });

    return () => {
      mounted = false;
      eventSource.close();
    };
  }, []);

  const qrImageUrl = useMemo(() => {
    if (!pairing?.qr) {
      return null;
    }

    const encoded = encodeURIComponent(pairing.qr);
    return `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encoded}`;
  }, [pairing]);

  const isWaitingForQr = pairing?.status === "pairing" && !qrImageUrl;
  const connectedPhoneDigits = connection?.phoneNumber ? phoneFromJid(connection.phoneNumber) : "";
  const normalizedSelfChatNumber = normalizePhoneDigits(selfChatNumber || connectedPhoneDigits);
  const computedMainChannelJid =
    mainChannelMode === "self"
      ? normalizedSelfChatNumber
        ? `${normalizedSelfChatNumber}${SELF_CHAT_SUFFIX}`
        : ""
      : mainGroupJid;

  const loadGroups = async (): Promise<void> => {
    setGroupsError(null);
    const response = await fetch("/api/channels/whatsapp/groups");
    const payload = await tryReadJson<{ status: string; groups?: GroupItem[] }>(response);

    if (!response.ok || !payload || payload.status !== "ok") {
      setGroupsError("Connect WhatsApp first, then retry group sync.");
      return;
    }

    setGroups(payload.groups ?? []);
  };

  const mergedGroups = useMemo(() => {
    const map = new Map<string, GroupItem>();

    for (const group of groups) {
      map.set(group.jid, group);
    }

    for (const [jid, chat] of Object.entries(registeredChats)) {
      if (!chat.isMain && !map.has(jid)) {
        map.set(jid, {
          jid,
          name: chat.name,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [groups, registeredChats]);

  const selectedGroupItems = useMemo(() => {
    return mergedGroups.filter((group) => selectedGroups[group.jid]);
  }, [mergedGroups, selectedGroups]);

  const saveConfig = async (): Promise<void> => {
    setSavingConfig(true);
    setConfigMessage(null);

    try {
      const mainChannelJid = computedMainChannelJid.trim();
      if (!mainChannelJid) {
        throw new Error(
          mainChannelMode === "self"
            ? "Enter your WhatsApp number for self-chat."
            : "Select a main group channel.",
        );
      }

      const mainGroup = mergedGroups.find((group) => group.jid === mainChannelJid);
      const effectiveMainName =
        mainChannelMode === "self" ? "Self Chat" : mainGroup?.name ?? "Main Group";

      if (mainChannelMode === "group" && !mainGroup) {
        throw new Error("Main group must be selected from Whitelist Groups.");
      }

      const chats = [
        {
          jid: mainChannelJid,
          name: effectiveMainName,
          requiresTrigger: true,
          isMain: true,
        },
        ...mergedGroups
          .filter((group) => selectedGroups[group.jid])
          .map((group) => ({
            jid: group.jid,
            name: group.name,
            requiresTrigger: true,
            isMain: false,
          })),
      ];

      const response = await fetch("/api/channels/whatsapp/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assistantName,
          mainChannelJid,
          mainChannelName: effectiveMainName,
          mainChannelRequiresTrigger: true,
          chats,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save bot config");
      }

      setConfigMessage("Configuration saved.");
    } catch (error) {
      setConfigMessage(error instanceof Error ? error.message : "Failed to save config");
    } finally {
      setSavingConfig(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading channel manager...</p>;
  }

  return (
    <TooltipProvider>
      <section className="space-y-4">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Channels</p>
        <h2 className="mt-2 text-2xl font-semibold">WhatsApp</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Pair your device, sync groups, and persist bot config in workspace DB.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Pairing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              State: <span className="font-medium text-foreground">{pairing?.status ?? "idle"}</span>
            </p>
            <p className="text-sm text-muted-foreground">
              Connection:{" "}
              <span className="font-medium text-foreground">{connection?.status ?? "unknown"}</span>
            </p>
            {connection?.phoneNumber ? (
              <p className="text-sm text-muted-foreground">Phone: {connection.phoneNumber}</p>
            ) : null}
            {pairing?.backend ? (
              <p className="text-sm text-muted-foreground">Auth backend: {pairing.backend}</p>
            ) : null}
            {pairing?.error ? <p className="text-sm text-destructive">{pairing.error}</p> : null}

            <div className="flex gap-2">
              <Button
                disabled={pairing?.status === "pairing"}
                onClick={async () => {
                  const response = await fetch("/api/channels/whatsapp/pair", { method: "POST" });
                  if (!response.ok) {
                    setConfigMessage("Failed to start pairing.");
                    return;
                  }
                  await loadStatus();
                  setConfigMessage(null);
                }}
              >
                {pairing?.status === "pairing" ? "Pairing..." : "Start Pairing"}
              </Button>
              <Button
                variant="secondary"
                onClick={async () => {
                  const response = await fetch("/api/channels/whatsapp/disconnect", { method: "POST" });
                  if (!response.ok) {
                    setConfigMessage("Failed to disconnect WhatsApp.");
                    return;
                  }
                  await loadStatus();
                  setConfigMessage(null);
                }}
              >
                Disconnect
              </Button>
            </div>

            {qrImageUrl ? (
              <div className="space-y-2">
                {/* Uses a remote QR renderer to avoid client-side QR library dependency. */}
                <img src={qrImageUrl} width={256} height={256} alt="WhatsApp pairing QR code" />
                <p className="text-xs text-muted-foreground">
                  Scan with WhatsApp {"->"} Linked Devices {"->"} Link a Device.
                </p>
              </div>
            ) : isWaitingForQr ? (
              <p className="text-sm text-muted-foreground">
                Starting pairing session. Waiting for QR code from WhatsApp...
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Start pairing to receive a live QR code.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bot Config</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="block space-y-1">
              <span className="flex items-center gap-1 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                Assistant Name
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="cursor-help text-muted-foreground/90">
                      <CircleHelp className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={6}>
                    In self-chat, start messages with this name (example: &quot;Mike hi&quot;) so the bot picks them up.
                  </TooltipContent>
                </Tooltip>
              </span>
              <Input value={assistantName} onChange={(event) => setAssistantName(event.target.value)} />
            </label>

            <label className="block space-y-1">
              <span className="flex items-center gap-1 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                Main Channel
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="cursor-help text-muted-foreground/90">
                      <CircleHelp className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={6}>
                    Choose where bot-trigger messages should be sent from: your self-chat or one group.
                    For self, enter only your country-code phone number, without a leading plus sign.
                  </TooltipContent>
                </Tooltip>
              </span>
              <div className="flex items-center gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="main-channel-mode"
                    checked={mainChannelMode === "self"}
                    onChange={() => setMainChannelMode("self")}
                  />
                  Self Chat
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="main-channel-mode"
                    checked={mainChannelMode === "group"}
                    onChange={() => setMainChannelMode("group")}
                  />
                  Group
                </label>
              </div>

              {mainChannelMode === "self" ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={selfChatNumber}
                      placeholder={connectedPhoneDigits || "6582521181"}
                      onChange={(event) => setSelfChatNumber(normalizePhoneDigits(event.target.value))}
                    />
                    <span className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
                      {SELF_CHAT_SUFFIX}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Your self-chat JID will be:{" "}
                    <code>{computedMainChannelJid || `&lt;number&gt;${SELF_CHAT_SUFFIX}`}</code>
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <select
                    className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                    value={mainGroupJid}
                    onChange={(event) => setMainGroupJid(event.target.value)}
                  >
                    <option value="">Select a group</option>
                    {mergedGroups.map((group) => (
                      <option key={group.jid} value={group.jid}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Group IDs are fetched by WhatsApp integration so users do not need to type JIDs manually.
                  </p>
                </div>
              )}
            </label>

            <div className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-1 text-sm font-medium">
                  Registered Groups
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" className="cursor-help text-muted-foreground/90">
                        <CircleHelp className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={6}>
                      Groups checked here are whitelisted for bot responses.
                    </TooltipContent>
                  </Tooltip>
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    if (!showGroupEditor) {
                      await loadGroups();
                    }
                    setShowGroupEditor((current) => !current);
                  }}
                >
                  Whitelist Groups
                </Button>
              </div>

              {groupsError ? <p className="text-sm text-destructive">{groupsError}</p> : null}

              {selectedGroupItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">No groups currently whitelisted.</p>
              ) : (
                <div className="space-y-2">
                  {selectedGroupItems.map((group) => (
                    <div key={group.jid} className="rounded-md border border-border px-3 py-2 text-sm">
                      <p className="font-medium text-foreground">{group.name}</p>
                      <p className="text-xs text-muted-foreground">{group.jid}</p>
                    </div>
                  ))}
                </div>
              )}

              {showGroupEditor ? (
                <div className="space-y-2 rounded-md border border-dashed border-border p-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                    Edit Whitelist
                  </p>
                  {mergedGroups.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No groups loaded yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {mergedGroups.map((group) => (
                        <label key={group.jid} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={Boolean(selectedGroups[group.jid])}
                            onChange={(event) => {
                              setSelectedGroups((current) => ({
                                ...current,
                                [group.jid]: event.target.checked,
                              }));
                            }}
                          />
                          <span>{group.name}</span>
                          <span className="text-xs text-muted-foreground">{group.jid}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <Button disabled={savingConfig || !computedMainChannelJid.trim()} onClick={() => void saveConfig()}>
              {savingConfig ? "Saving..." : "Save Config"}
            </Button>

            {configMessage ? <p className="text-sm text-muted-foreground">{configMessage}</p> : null}
          </CardContent>
        </Card>
      </div>
      </section>
    </TooltipProvider>
  );
}
