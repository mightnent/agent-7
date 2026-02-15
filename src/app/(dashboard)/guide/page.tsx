"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, ArrowRight } from "lucide-react";

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

interface GuideStep {
  id: string;
  title: string;
  description: string;
  checkNames: string[];
  href: string;
  linkLabel: string;
}

const GUIDE_STEPS: GuideStep[] = [
  {
    id: "manus-config",
    title: "Configure Manus API",
    description:
      "Enter your Manus API key and webhook secret. These credentials authenticate your workspace with the Manus task execution service.",
    checkNames: ["manus_api_key", "manus_webhook_secret"],
    href: "/config",
    linkLabel: "Open Config",
  },
  {
    id: "whatsapp-pair",
    title: "Pair WhatsApp",
    description:
      "Connect your WhatsApp account by scanning a QR code. This links your phone to the agent so it can send and receive messages on your behalf.",
    checkNames: ["whatsapp"],
    href: "/channels",
    linkLabel: "Open Channels",
  },
  {
    id: "tunnel-start",
    title: "Start Tunnel",
    description:
      "Launch a Cloudflare tunnel to expose your local server to the internet. This lets Manus deliver webhook events (task updates, results) back to your agent.",
    checkNames: ["tunnel", "webhook"],
    href: "/tunnel",
    linkLabel: "Open Tunnel",
  },
];

const resolveStepStatus = (step: GuideStep, checks: HealthCheck[]): "complete" | "incomplete" => {
  return step.checkNames.every((name) => {
    const check = checks.find((c) => c.name === name);
    return check?.status === "ok";
  })
    ? "complete"
    : "incomplete";
};

export default function GuidePage() {
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHealth = async () => {
    try {
      const response = await fetch("/api/status/health", { cache: "no-store" });
      if (response.ok) {
        const data = (await response.json()) as HealthResponse;
        setChecks(data.checks);
      }
    } catch {
      // Retain previous state on error.
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

  const completedSteps = GUIDE_STEPS.filter((step) => resolveStepStatus(step, checks) === "complete").length;
  const allComplete = completedSteps === GUIDE_STEPS.length;

  // Find first incomplete step
  const activeStepIndex = GUIDE_STEPS.findIndex((step) => resolveStepStatus(step, checks) === "incomplete");

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading setup guide...</p>;
  }

  return (
    <section className="space-y-4">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Setup</p>
        <h2 className="mt-2 text-2xl font-semibold">Getting Started</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Complete these steps to connect your WhatsApp agent to Manus. Progress is auto-detected.
        </p>
      </header>

      {/* Progress indicator */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {allComplete ? "Setup complete!" : `Step ${activeStepIndex + 1} of ${GUIDE_STEPS.length}`}
            </p>
            <p className="text-sm text-muted-foreground">
              {completedSteps}/{GUIDE_STEPS.length} complete
            </p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-600 transition-all duration-500"
              style={{ width: `${(completedSteps / GUIDE_STEPS.length) * 100}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Steps */}
      <div className="space-y-3">
        {GUIDE_STEPS.map((step, index) => {
          const status = resolveStepStatus(step, checks);
          const isActive = index === activeStepIndex;
          const isComplete = status === "complete";

          return (
            <Card
              key={step.id}
              className={
                isActive
                  ? "border-primary/50 shadow-sm"
                  : isComplete
                    ? "border-emerald-200 bg-emerald-50/30"
                    : ""
              }
            >
              <CardHeader className="pb-2">
                <div className="flex items-start gap-3">
                  {isComplete ? (
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
                  ) : (
                    <Circle className={`mt-0.5 size-5 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                  )}
                  <div className="min-w-0 flex-1">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <span className="text-muted-foreground">Step {index + 1}.</span>
                      {step.title}
                      {isComplete ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-700">
                          Done
                        </span>
                      ) : null}
                    </CardTitle>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pl-11">
                <p className="text-sm text-muted-foreground">{step.description}</p>

                {/* Status detail for each sub-check */}
                <div className="mt-2 space-y-1">
                  {step.checkNames.map((checkName) => {
                    const check = checks.find((c) => c.name === checkName);
                    if (!check) return null;
                    return (
                      <p
                        key={checkName}
                        className={`text-xs ${
                          check.status === "ok" ? "text-emerald-600" : "text-muted-foreground"
                        }`}
                      >
                        {check.status === "ok" ? "\u2713" : "\u2022"} {check.detail}
                      </p>
                    );
                  })}
                </div>

                {!isComplete ? (
                  <div className="mt-3">
                    <Button asChild size="sm" variant={isActive ? "default" : "outline"}>
                      <Link href={step.href}>
                        {step.linkLabel}
                        <ArrowRight className="ml-1.5 size-3.5" />
                      </Link>
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {allComplete ? (
        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 size-5 text-emerald-600" />
              <div>
                <p className="text-sm font-medium">You&apos;re all set!</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Your agent is connected and ready to process tasks. Send a message on WhatsApp to get started, or
                  check the{" "}
                  <Link href="/status" className="underline underline-offset-2">
                    Status dashboard
                  </Link>{" "}
                  for live health monitoring.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
