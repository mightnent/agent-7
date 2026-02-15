import { NextResponse } from "next/server";

import { requireOssApiAccess } from "@/lib/api/oss-admin-guard";
import { getBaileysRuntimeState } from "@/lib/channel/whatsapp-bootstrap";
import { getWhatsAppChannelState } from "@/lib/channel/workspace-channel-service";
import { getDefaultWorkspaceSetting } from "@/lib/config/settings-service";
import { getTunnelStatus } from "@/lib/tunnel/manager";
import { resolveWorkspaceId } from "@/lib/workspace/default-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckStatus = "ok" | "warning" | "error" | "unconfigured";

interface HealthCheck {
  name: string;
  status: CheckStatus;
  detail: string | null;
}

export async function GET(request: Request): Promise<Response> {
  const guard = await requireOssApiAccess(request);
  if (guard) {
    return guard;
  }

  const workspaceId = resolveWorkspaceId();

  const [manusApiKey, manusWebhookSecret, whatsappChannel, tunnel, baileys] = await Promise.all([
    getDefaultWorkspaceSetting("manus", "api_key"),
    getDefaultWorkspaceSetting("manus", "webhook_secret"),
    getWhatsAppChannelState(workspaceId),
    getTunnelStatus(),
    getBaileysRuntimeState(),
  ]);

  const checks: HealthCheck[] = [];

  // 1. Manus API key
  checks.push({
    name: "manus_api_key",
    status: manusApiKey ? "ok" : "unconfigured",
    detail: manusApiKey ? "API key is set" : "Set your Manus API key in Config > Manus",
  });

  // 2. Manus webhook secret
  checks.push({
    name: "manus_webhook_secret",
    status: manusWebhookSecret ? "ok" : "unconfigured",
    detail: manusWebhookSecret ? "Webhook secret is set" : "Set your Manus webhook secret in Config > Manus",
  });

  // 3. WhatsApp connection
  const waConnected = whatsappChannel.status === "connected";
  const waBaileysBooted = baileys.booted && baileys.connected;
  checks.push({
    name: "whatsapp",
    status: waConnected || waBaileysBooted ? "ok" : whatsappChannel.phoneNumber ? "warning" : "unconfigured",
    detail: waConnected || waBaileysBooted
      ? `Connected${whatsappChannel.phoneNumber ? ` (${whatsappChannel.phoneNumber})` : ""}`
      : whatsappChannel.phoneNumber
        ? "Previously paired but not currently connected"
        : "Pair your WhatsApp device in Channels",
  });

  // 4. Tunnel
  const tunnelRunning = tunnel.status === "running" && tunnel.publicUrl;
  checks.push({
    name: "tunnel",
    status: tunnelRunning ? "ok" : tunnel.status === "starting" ? "warning" : "unconfigured",
    detail: tunnelRunning
      ? `Running at ${tunnel.publicUrl}`
      : tunnel.status === "starting"
        ? "Tunnel is starting..."
        : tunnel.lastError
          ? `Error: ${tunnel.lastError}`
          : "Start a Cloudflare tunnel to receive Manus webhooks",
  });

  // 5. Webhook registration
  const webhookRegistered = tunnel.webhook.status === "registered";
  checks.push({
    name: "webhook",
    status: webhookRegistered ? "ok" : tunnel.webhook.status === "registering" ? "warning" : tunnelRunning ? "error" : "unconfigured",
    detail: webhookRegistered
      ? `Registered${tunnel.webhook.registeredAt ? ` at ${tunnel.webhook.registeredAt}` : ""}`
      : tunnel.webhook.status === "registering"
        ? "Registering webhook..."
        : tunnel.webhook.lastError
          ? `Error: ${tunnel.webhook.lastError}`
          : "Webhook will be auto-registered when the tunnel starts",
  });

  const overall: CheckStatus = checks.every((c) => c.status === "ok")
    ? "ok"
    : checks.some((c) => c.status === "error")
      ? "error"
      : checks.some((c) => c.status === "warning")
        ? "warning"
        : "unconfigured";

  return NextResponse.json({
    status: overall,
    checks,
    timestamp: new Date().toISOString(),
  });
}
