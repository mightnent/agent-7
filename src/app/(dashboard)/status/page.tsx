"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type CheckStatus = "ok" | "warning" | "error" | "unconfigured";

interface HealthCheck {
  name: string;
  status: CheckStatus;
  detail: string | null;
}

interface HealthResponse {
  status: CheckStatus;
  checks: HealthCheck[];
  timestamp: string;
}

const STATUS_ICON: Record<CheckStatus, React.ReactNode> = {
  ok: <CheckCircle2 className="size-5 text-emerald-600" />,
  warning: <AlertTriangle className="size-5 text-amber-500" />,
  error: <XCircle className="size-5 text-red-600" />,
  unconfigured: <HelpCircle className="size-5 text-muted-foreground" />,
};

const STATUS_LABEL: Record<CheckStatus, string> = {
  ok: "Healthy",
  warning: "Warning",
  error: "Error",
  unconfigured: "Not Configured",
};

const CHECK_LABELS: Record<string, string> = {
  manus_api_key: "Manus API Key",
  manus_webhook_secret: "Manus Webhook Secret",
  whatsapp: "WhatsApp Connection",
  tunnel: "Cloudflare Tunnel",
  webhook: "Manus Webhook",
};

export default function StatusPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadHealth = async () => {
    try {
      const response = await fetch("/api/status/health", { cache: "no-store" });
      if (response.ok) {
        const data = (await response.json()) as HealthResponse;
        setHealth(data);
      }
    } catch {
      // Silently fail; previous state is retained.
    }
  };

  useEffect(() => {
    let active = true;

    const tick = async () => {
      await loadHealth();
      if (active) {
        setLoading(false);
      }
    };

    void tick();
    const interval = setInterval(() => void tick(), 5_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadHealth();
    setRefreshing(false);
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading system health...</p>;
  }

  const overallStatus = health?.status ?? "unconfigured";
  const okCount = health?.checks.filter((c) => c.status === "ok").length ?? 0;
  const totalCount = health?.checks.length ?? 0;

  return (
    <section className="space-y-4">
      <header className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Monitor</p>
          <h2 className="mt-2 text-2xl font-semibold">System Status</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Live health checks across all subsystems. Refreshes every 5 seconds.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void handleRefresh()} disabled={refreshing}>
          <RefreshCw className={`mr-1.5 size-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            {STATUS_ICON[overallStatus]}
            <div>
              <CardTitle className="text-lg">
                {overallStatus === "ok"
                  ? "All Systems Operational"
                  : overallStatus === "warning"
                    ? "Partial Issues Detected"
                    : overallStatus === "error"
                      ? "System Errors"
                      : "Setup Incomplete"}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {okCount}/{totalCount} checks passing
                {health?.timestamp ? ` — last checked ${new Date(health.timestamp).toLocaleTimeString()}` : ""}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-border">
            {health?.checks.map((check) => (
              <div key={check.name} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                {STATUS_ICON[check.status]}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{CHECK_LABELS[check.name] ?? check.name}</p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                        check.status === "ok"
                          ? "bg-emerald-100 text-emerald-700"
                          : check.status === "warning"
                            ? "bg-amber-100 text-amber-700"
                            : check.status === "error"
                              ? "bg-red-100 text-red-700"
                              : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {STATUS_LABEL[check.status]}
                    </span>
                  </div>
                  {check.detail ? <p className="mt-0.5 text-sm text-muted-foreground">{check.detail}</p> : null}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
