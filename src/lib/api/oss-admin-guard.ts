import { NextResponse } from "next/server";
import { DEFAULT_WORKSPACE_ID } from "@/db/schema";
import { getEnv } from "@/lib/env";

const normalizeHost = (host: string | null): string => {
  if (!host) {
    return "";
  }

  if (host.startsWith("[")) {
    const idx = host.indexOf("]");
    if (idx > 0) {
      return host.slice(1, idx).toLowerCase();
    }
  }

  const [hostname] = host.split(":");
  return hostname.toLowerCase();
};

const isLoopbackHost = (host: string | null): boolean => {
  const normalized = normalizeHost(host);
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
};

const isSameOrigin = (request: Request): boolean => {
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");

  if (!host || !origin) {
    return false;
  }

  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
};

export const requireOssAdminRequest = (request: Request): Response | null => {
  if (isSameOrigin(request)) {
    return null;
  }

  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "same-origin") {
    return null;
  }

  if (isLoopbackHost(request.headers.get("host"))) {
    return null;
  }

  return NextResponse.json(
    {
      status: "unauthorized",
      error: "This OSS admin route only accepts same-origin or loopback requests.",
    },
    { status: 401 },
  );
};

const readProvidedMockToken = (request: Request): string | null => {
  const mockHeader = request.headers.get("x-mock-token")?.trim();
  if (mockHeader) {
    return mockHeader;
  }

  const legacyInternalHeader = request.headers.get("x-internal-token")?.trim();
  if (legacyInternalHeader) {
    return legacyInternalHeader;
  }

  const authHeader = request.headers.get("authorization")?.trim();
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice("bearer ".length).trim();
    return token || null;
  }

  return null;
};

export const requireOssApiAccess = async (
  request: Request,
  workspaceId = DEFAULT_WORKSPACE_ID,
): Promise<Response | null> => {
  const originGuard = requireOssAdminRequest(request);
  if (!originGuard) {
    return null;
  }

  const env = await getEnv(workspaceId);
  const configuredToken = (env.MOCK_TOKEN || env.INTERNAL_CLEANUP_TOKEN).trim();
  const providedToken = readProvidedMockToken(request);

  if (configuredToken) {
    if (providedToken === configuredToken) {
      return null;
    }

    return NextResponse.json(
      {
        status: "unauthorized",
        error:
          "Mock token required. Provide x-mock-token (or Authorization: Bearer <token>) for OSS admin API access.",
      },
      { status: 401 },
    );
  }

  return originGuard;
};
