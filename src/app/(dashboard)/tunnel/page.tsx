"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface TunnelSnapshot {
  status: "idle" | "starting" | "running" | "stopped" | "error";
  pid: number | null;
  localPort: number;
  publicUrl: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  lastError: string | null;
  lastLog: string | null;
  webhook: {
    status: "idle" | "registering" | "registered" | "error";
    baseUrl: string | null;
    registeredAt: string | null;
    lastError: string | null;
  };
}

const readJson = async <T,>(response: Response): Promise<T | null> => {
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

const formatTime = (value: string | null): string => {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
};

export default function TunnelPage() {
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<"start" | "stop" | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [tunnel, setTunnel] = useState<TunnelSnapshot | null>(null);

  const loadStatus = async (): Promise<void> => {
    const response = await fetch("/api/tunnel/status", { cache: "no-store" });
    const payload = await readJson<{ status: string; tunnel?: TunnelSnapshot; error?: string }>(response);

    if (!response.ok || !payload?.tunnel) {
      setErrorMessage(payload?.error ?? "Unable to load tunnel status.");
      return;
    }

    setTunnel(payload.tunnel);
    setErrorMessage(null);
  };

  useEffect(() => {
    let active = true;

    const tick = async () => {
      await loadStatus();
      if (active) {
        setLoading(false);
      }
    };

    void tick();
    const interval = setInterval(() => {
      void tick();
    }, 3_000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const trigger = async (action: "start" | "stop"): Promise<void> => {
    setPending(action);
    setStatusMessage(null);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/tunnel/${action}`, {
        method: "POST",
      });

      const payload = await readJson<{ status: string; tunnel?: TunnelSnapshot; error?: string }>(response);
      if (!response.ok || !payload?.tunnel) {
        throw new Error(payload?.error ?? `Tunnel ${action} failed.`);
      }

      setTunnel(payload.tunnel);
      setStatusMessage(action === "start" ? "Tunnel start requested." : "Tunnel stopped.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : `Tunnel ${action} failed.`);
    } finally {
      setPending(null);
    }
  };

  const canStart = useMemo(() => {
    return pending === null && tunnel?.status !== "starting" && tunnel?.status !== "running";
  }, [pending, tunnel?.status]);

  const canStop = useMemo(() => {
    return pending === null && (tunnel?.status === "starting" || tunnel?.status === "running");
  }, [pending, tunnel?.status]);

  const installHint = useMemo(() => {
    const message = `${tunnel?.lastError ?? ""} ${tunnel?.lastLog ?? ""}`.toLowerCase();
    if (message.includes("enoent") || message.includes("command not found") || message.includes("cloudflared")) {
      return "cloudflared not found. Install it first, then retry (macOS: brew install cloudflare/cloudflare/cloudflared).";
    }
    return null;
  }, [tunnel?.lastError, tunnel?.lastLog]);

  return (
    <section className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Cloudflare Tunnel</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void trigger("start")} disabled={!canStart}>
              {pending === "start" ? "Starting..." : "Start Tunnel"}
            </Button>
            <Button variant="outline" onClick={() => void trigger("stop")} disabled={!canStop}>
              {pending === "stop" ? "Stopping..." : "Stop Tunnel"}
            </Button>
            <span className="text-sm text-muted-foreground">Status: {tunnel?.status ?? "unknown"}</span>
          </div>

          {loading ? <p className="text-sm text-muted-foreground">Loading status...</p> : null}
          {statusMessage ? <p className="text-sm text-green-700">{statusMessage}</p> : null}
          {errorMessage ? <p className="text-sm text-red-700">{errorMessage}</p> : null}
          {installHint ? <p className="text-sm text-amber-700">{installHint}</p> : null}

          <div className="grid gap-2 text-sm">
            <div>
              <strong>Public URL:</strong> {tunnel?.publicUrl ?? "-"}
            </div>
            <div>
              <strong>Webhook Base URL:</strong> {tunnel?.webhook.baseUrl ?? "-"}
            </div>
            <div>
              <strong>Webhook Status:</strong> {tunnel?.webhook.status ?? "-"}
            </div>
            {tunnel?.webhook.lastError ? (
              <div className="text-red-700">
                <strong>Webhook Error:</strong> {tunnel.webhook.lastError}
              </div>
            ) : null}
            <div>
              <strong>Local Port:</strong> {tunnel?.localPort ?? 3000}
            </div>
            <div>
              <strong>PID:</strong> {tunnel?.pid ?? "-"}
            </div>
            <div>
              <strong>Started:</strong> {formatTime(tunnel?.startedAt ?? null)}
            </div>
            <div>
              <strong>Stopped:</strong> {formatTime(tunnel?.stoppedAt ?? null)}
            </div>
            {tunnel?.lastError ? (
              <div className="text-red-700">
                <strong>Runtime Error:</strong> {tunnel.lastError}
              </div>
            ) : null}
            {tunnel?.lastLog ? (
              <div className="text-muted-foreground">
                <strong>Last Log:</strong> {tunnel.lastLog}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
