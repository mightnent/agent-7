import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOssApiAccess } from "@/lib/api/oss-admin-guard";
import { settingsService } from "@/lib/config/settings-service";
import {
  getSettingDefinitionsByCategory,
  SETTINGS_CATEGORIES,
  type SettingsCategory,
} from "@/lib/config/settings-catalog";
import { ManusApiError, ManusClient } from "@/lib/manus/client";
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

const normalizeWebhookUrl = (value: string): string => {
  try {
    const url = new URL(value);
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value;
  }
};

const normalizeSettingValue = (category: SettingsCategory, key: string, value: string): string => {
  if (category === "manus" && key === "webhook_url") {
    return normalizeWebhookUrl(value);
  }

  return value;
};

const ensureManusProjectExists = async (
  workspaceId: string,
): Promise<{ projectId: string | null; createdNow: boolean }> => {
  const [projectIdRaw, projectInstructionsRaw, apiKeyRaw, baseUrlRaw] = await Promise.all([
    settingsService.get(workspaceId, "manus", "project_id"),
    settingsService.get(workspaceId, "manus", "project_instructions"),
    settingsService.get(workspaceId, "manus", "api_key"),
    settingsService.get(workspaceId, "manus", "base_url"),
  ]);

  const projectId = projectIdRaw?.trim();
  const apiKey = apiKeyRaw?.trim();
  const baseUrl = baseUrlRaw?.trim() || "https://api.manus.ai";
  const projectInstructions = projectInstructionsRaw?.trim() ?? "";

  if (!apiKey) {
    return { projectId: null, createdNow: false };
  }

  if (projectId) {
    return { projectId, createdNow: false };
  }

  const client = new ManusClient({
    apiKey,
    baseUrl,
  });

  const created = await client.createProject({
    name: "Agent-7",
    instruction: projectInstructions,
  });
  const createdProjectId = created.project_id.trim();

  await settingsService.set(workspaceId, "manus", "project_id", createdProjectId);
  return { projectId: createdProjectId, createdNow: true };
};

const syncProjectInstructionsToManus = async (
  workspaceId: string,
  projectId: string | null,
): Promise<void> => {
  const [projectInstructionsRaw, apiKeyRaw, baseUrlRaw] = await Promise.all([
    settingsService.get(workspaceId, "manus", "project_instructions"),
    settingsService.get(workspaceId, "manus", "api_key"),
    settingsService.get(workspaceId, "manus", "base_url"),
  ]);

  const normalizedProjectId = projectId?.trim();
  const apiKey = apiKeyRaw?.trim();
  const baseUrl = baseUrlRaw?.trim() || "https://api.manus.ai";

  if (!normalizedProjectId || !apiKey) {
    return;
  }

  const client = new ManusClient({
    apiKey,
    baseUrl,
  });

  await client.updateProject(normalizedProjectId, {
    instruction: projectInstructionsRaw?.trim() ?? "",
  });
};

const syncWebhookRegistrationToManus = async (workspaceId: string): Promise<void> => {
  const [apiKeyRaw, baseUrlRaw, webhookBaseUrlRaw, webhookSecretRaw, webhookIdRaw] = await Promise.all([
    settingsService.get(workspaceId, "manus", "api_key"),
    settingsService.get(workspaceId, "manus", "base_url"),
    settingsService.get(workspaceId, "manus", "webhook_url"),
    settingsService.get(workspaceId, "manus", "webhook_secret"),
    settingsService.get(workspaceId, "manus", "webhook_id"),
  ]);

  const apiKey = apiKeyRaw?.trim();
  const baseUrl = baseUrlRaw?.trim() || "https://api.manus.ai";
  const webhookBaseUrl = webhookBaseUrlRaw?.trim();
  const webhookSecret = webhookSecretRaw?.trim();
  const webhookId = webhookIdRaw?.trim();

  if (!apiKey || !webhookBaseUrl || !webhookSecret) {
    return;
  }

  const callbackUrl = new URL("/api/manus/webhook", webhookBaseUrl);
  callbackUrl.searchParams.set("secret", webhookSecret);

  const client = new ManusClient({
    apiKey,
    baseUrl,
  });

  if (webhookId) {
    try {
      await client.deleteWebhook(webhookId);
    } catch (error) {
      if (!(error instanceof ManusApiError && error.status === 404)) {
        throw error;
      }
    }
  }

  const createdWebhookId = await client.registerWebhook(callbackUrl.toString());
  await settingsService.set(workspaceId, "manus", "webhook_id", createdWebhookId ?? "");
};

export async function GET(
  request: Request,
  context: {
    params: Promise<{ category: string }>;
  },
): Promise<Response> {
  const guard = await requireOssApiAccess(request);
  if (guard) {
    return guard;
  }

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
      value: normalizeSettingValue(
        category,
        definition.key,
        (await settingsService.get(workspaceId, category, definition.key)) ?? "",
      ),
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
  const guard = await requireOssApiAccess(request);
  if (guard) {
    return guard;
  }

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
      await settingsService.set(workspaceId, category, key, normalizeSettingValue(category, key, value));
    }

    const shouldEnsureManusProject =
      category === "manus" &&
      updates.some(([key]) => key === "api_key" || key === "project_instructions");
    const shouldSyncManusProjectInstructions =
      category === "manus" && updates.some(([key]) => key === "project_instructions");
    const shouldSyncWebhookRegistration =
      category === "manus" &&
      updates.some(([key]) => key === "api_key" || key === "base_url" || key === "webhook_url" || key === "webhook_secret");
    if (shouldEnsureManusProject || shouldSyncManusProjectInstructions) {
      const { projectId, createdNow } = await ensureManusProjectExists(workspaceId);
      if (shouldSyncManusProjectInstructions && !createdNow) {
        try {
          await syncProjectInstructionsToManus(workspaceId, projectId);
        } catch (error) {
          if (!(error instanceof ManusApiError && error.status === 404)) {
            throw error;
          }

          const instruction = (await settingsService.get(workspaceId, "manus", "project_instructions"))?.trim() ?? "";
          const apiKey = (await settingsService.get(workspaceId, "manus", "api_key"))?.trim();
          const baseUrl = (await settingsService.get(workspaceId, "manus", "base_url"))?.trim() || "https://api.manus.ai";

          if (!apiKey) {
            return NextResponse.json({
              status: "ok",
              updated: updates.map(([key]) => key),
            });
          }

          const replacementClient = new ManusClient({ apiKey, baseUrl });
          const replacementProject = await replacementClient.createProject({
            name: "Agent-7",
            instruction,
          });
          await settingsService.set(workspaceId, "manus", "project_id", replacementProject.project_id);
        }
      }
    }

    if (shouldSyncWebhookRegistration) {
      await syncWebhookRegistrationToManus(workspaceId);
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
