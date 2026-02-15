import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const keyHex = randomBytes(32).toString("hex");

  return NextResponse.json({
    status: "ok",
    key: keyHex,
    format: "hex-64",
    instruction: "Put this value in DB_ENCRYPTION_KEY in .env and restart the server.",
  });
}
