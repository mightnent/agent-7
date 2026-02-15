import { NextResponse } from "next/server";

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
