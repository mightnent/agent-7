import { NextResponse } from "next/server";
import { z } from "zod";

import { settingsService } from "@/lib/config/settings-service";
import {
  getSettingDefinitionsByCategory,
  SETTINGS_CATEGORIES,
  type SettingsCategory,
} from "@/lib/config/settings-catalog";
import { resolveWorkspaceId } from "@/lib/workspace/default-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const putPayloadSchema = z.object({
  settings: z.record(z.string(), z.string()),
});

const parseCategory = (raw: string): SettingsCategory | null => {
  if ((SETTINGS_CATEGORIES as readonly string[]).includes(raw)) {
    return raw as SettingsCategory;
  }

  return null;
};

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ category: string }>;
  },
): Promise<Response> {
  const workspaceId = resolveWorkspaceId();
  const { category: rawCategory } = await context.params;
  const category = parseCategory(rawCategory);

  if (!category) {
    return NextResponse.json({ status: "invalid_category" }, { status: 400 });
  }

  const definitions = getSettingDefinitionsByCategory(category);
  const settings = await Promise.all(
    definitions.map(async (definition) => ({
      key: definition.key,
      sensitive: definition.sensitive,
      value: (await settingsService.get(workspaceId, category, definition.key)) ?? "",
    })),
  );

  return NextResponse.json({
    status: "ok",
    category,
    settings,
  });
}

export async function PUT(
  request: Request,
  context: {
    params: Promise<{ category: string }>;
  },
): Promise<Response> {
  const workspaceId = resolveWorkspaceId();
  const { category: rawCategory } = await context.params;
  const category = parseCategory(rawCategory);

  if (!category) {
    return NextResponse.json({ status: "invalid_category" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = putPayloadSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        status: "invalid_payload",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const definitions = getSettingDefinitionsByCategory(category);
  const allowedKeys = new Set(definitions.map((definition) => definition.key));
  const updates = Object.entries(parsed.data.settings).filter(([key]) => allowedKeys.has(key));

  try {
    for (const [key, value] of updates) {
      await settingsService.set(workspaceId, category, key, value);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to persist settings";
    return NextResponse.json(
      {
        status: "error",
        error: message,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    status: "ok",
    updated: updates.map(([key]) => key),
  });
}
