#!/usr/bin/env npx tsx
import "dotenv/config";

import { getEnv } from "@/lib/env";

const readArgValue = (name: string): string | null => {
  const idx = process.argv.findIndex((arg) => arg === name);
  if (idx === -1) {
    return null;
  }
  const value = process.argv[idx + 1];
  return value?.trim() || null;
};

const isLocalhostLike = (url: URL): boolean => {
  const host = url.hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
};

const redactUrl = (url: URL): string => {
  const cloned = new URL(url.toString());
  if (cloned.searchParams.has("secret")) {
    cloned.searchParams.set("secret", "***");
  }
  return cloned.toString();
};

const ensureCallbackUrl = async (): Promise<URL> => {
  const env = await getEnv();

  const fromArg = readArgValue("--url");
  const fromEnv = env.MANUS_WEBHOOK_URL?.trim();
  const raw = fromArg || fromEnv;

  if (!raw) {
    throw new Error(
      "Missing webhook callback URL. Set MANUS_WEBHOOK_URL in .env or pass --url https://<public-domain>/api/manus/webhook?secret=<secret>",
    );
  }

  const parsed = new URL(raw);

  // Convenience: if a bare origin is provided, build the expected webhook endpoint.
  // Example:
  //   https://abc.trycloudflare.com
  // -> https://abc.trycloudflare.com/api/manus/webhook?secret=<MANUS_WEBHOOK_SECRET>
  if (parsed.pathname === "/" && !parsed.search) {
    parsed.pathname = "/api/manus/webhook";
    parsed.searchParams.set("secret", env.MANUS_WEBHOOK_SECRET);
    return parsed;
  }

  // If path is provided but secret is missing, add it for consistency with receiver auth.
  if (!parsed.searchParams.get("secret")) {
    parsed.searchParams.set("secret", env.MANUS_WEBHOOK_SECRET);
  }

  return parsed;
};

const main = async (): Promise<void> => {
  const env = await getEnv();
  const callbackUrl = await ensureCallbackUrl();

  if (isLocalhostLike(callbackUrl)) {
    console.warn("Warning: localhost callback URL will not be reachable from Manus cloud.");
  }

  const registerUrl = new URL("/v1/webhooks", env.MANUS_BASE_URL).toString();
  const response = await fetch(registerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      API_KEY: env.MANUS_API_KEY,
    },
    body: JSON.stringify({
      webhook: {
        url: callbackUrl.toString(),
      },
    }),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Manus webhook registration failed (${response.status}): ${bodyText}`);
  }

  console.log("Webhook registered successfully.");
  console.log(`Callback URL: ${redactUrl(callbackUrl)}`);
  console.log(`Response: ${bodyText}`);
};

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
