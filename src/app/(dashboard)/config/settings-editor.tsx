"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleHelp, Eye, EyeOff } from "lucide-react";

import { MarkdownEditorModal } from "@/components/markdown-editor-modal";
import { MarkdownContent } from "@/components/markdown-content";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Category = "manus" | "agent" | "router" | "connectors" | "internal" | "whatsapp";

interface SettingRow {
  key: string;
  value: string;
  sensitive: boolean;
}

interface CategoryState {
  loading: boolean;
  saving: boolean;
  error: string | null;
  settings: SettingRow[];
}

interface MarkdownSettingConfig {
  title: string;
  emptyPlaceholder: string;
  helpText: string;
  modalTitle: string;
  modalDescription: string;
  infoTooltip?: string;
}

const CATEGORIES: Array<{ id: Category; label: string }> = [
  { id: "manus", label: "Manus" },
  { id: "agent", label: "Agent" },
  { id: "router", label: "Router" },
  { id: "connectors", label: "Connectors" },
  { id: "internal", label: "Internal" },
  { id: "whatsapp", label: "WhatsApp" },
];

const MARKDOWN_SETTINGS: Record<string, MarkdownSettingConfig> = {
  "manus:project_instructions": {
    title: "Project Instructions",
    emptyPlaceholder:
      "No project instructions configured. Add context about yourself and your preferences to help Manus produce better results.",
    helpText:
      "These instructions are sent to Manus with every task. Include information about yourself, your work context, preferred tools, and how you'd like tasks approached.",
    modalTitle: "Edit Project Instructions",
    modalDescription: "Write markdown instructions that define persistent context for Manus tasks.",
    infoTooltip:
      "Current Manus API limitation: project instruction updates may require creating a new project instead of updating the existing one.",
  },
  "agent:personality": {
    title: "Personality",
    emptyPlaceholder: "No personality configured. Agent-7 will use default template responses.",
    helpText:
      "Defines how Agent-7 communicates with you on WhatsApp - tone, verbosity, boundaries. Does not affect how Manus executes tasks.",
    modalTitle: "Edit Agent Personality",
    modalDescription: "Write markdown that describes Agent-7's communication style.",
  },
};

const AGENT_PROFILE_OPTIONS = [
  { value: "manus-1.6", label: "manus-1.6" },
  { value: "manus-1.6-lite", label: "manus-1.6-lite" },
  { value: "manus-1.6-max", label: "manus-1.6-max" },
] as const;

const LLM_PROVIDER_OPTIONS = [
  { value: "none", label: "None (disable router LLM)" },
  { value: "openai_compatible", label: "OpenAI-Compatible API" },
] as const;

const prettifyKey = (key: string): string => {
  if (key === "webhook_url") {
    return "Webhook Base URL";
  }
  if (key === "mock_token") {
    return "Mock Token";
  }

  return key
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
};

const buildComputedWebhookUrl = (baseUrl: string, secret: string): string => {
  if (!baseUrl.trim()) {
    return "";
  }

  try {
    const callback = new URL("/api/manus/webhook", baseUrl.trim());
    if (secret.trim()) {
      callback.searchParams.set("secret", secret.trim());
    }
    return callback.toString();
  } catch {
    return "";
  }
};

const createInitialState = (): Record<Category, CategoryState> => ({
  manus: { loading: true, saving: false, error: null, settings: [] },
  agent: { loading: true, saving: false, error: null, settings: [] },
  router: { loading: true, saving: false, error: null, settings: [] },
  connectors: { loading: true, saving: false, error: null, settings: [] },
  internal: { loading: true, saving: false, error: null, settings: [] },
  whatsapp: { loading: true, saving: false, error: null, settings: [] },
});

const getSelectOptions = (
  category: Category,
  key: string,
): ReadonlyArray<{ value: string; label: string }> | null => {
  if (category === "manus" && key === "agent_profile") {
    return AGENT_PROFILE_OPTIONS;
  }

  if (category === "router" && key === "llm_provider") {
    return LLM_PROVIDER_OPTIONS;
  }

  return null;
};

const getVisibleSettings = (category: Category, settings: SettingRow[]): SettingRow[] => {
  if (category === "manus") {
    return settings.filter((setting) => setting.key !== "project_id" && setting.key !== "webhook_id");
  }

  if (category === "connectors") {
    return settings.filter((setting) => setting.key === "enabled_uuids");
  }

  return settings;
};

const getSettingHelpText = (key: string): string | null => {
  if (key === "mock_token") {
    return "OSS-only mock auth token for API route protection. In managed mode, use short-lived JWT with authn/authz.";
  }
  if (key === "enabled_uuids") {
    return "Manus Apps/MCP connector UUID allowlist (comma-separated). Find each UUID in Manus: Settings -> Connectors -> open specific connector.";
  }

  return null;
};

const getMarkdownConfig = (category: Category, key: string): MarkdownSettingConfig | null => {
  return MARKDOWN_SETTINGS[`${category}:${key}`] ?? null;
};

const findSetting = (settings: SettingRow[], key: string): SettingRow | null => {
  return settings.find((setting) => setting.key === key) ?? null;
};

export function ConfigEditor() {
  const [state, setState] = useState<Record<Category, CategoryState>>(createInitialState);
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});
  const [generatedDbKey, setGeneratedDbKey] = useState<string>("");
  const [generatorError, setGeneratorError] = useState<string | null>(null);
  const [activeMarkdownEditor, setActiveMarkdownEditor] = useState<{ category: Category; key: string } | null>(null);

  useEffect(() => {
    void Promise.all(
      CATEGORIES.map(async ({ id }) => {
        try {
          const response = await fetch(`/api/settings/${id}`);
          const payload = (await response.json()) as {
            settings?: SettingRow[];
          };

          if (!response.ok) {
            throw new Error("Failed to load settings");
          }

          setState((current) => ({
            ...current,
            [id]: {
              ...current[id],
              loading: false,
              error: null,
              settings: payload.settings ?? [],
            },
          }));
        } catch {
          setState((current) => ({
            ...current,
            [id]: {
              ...current[id],
              loading: false,
              error: "Could not load this category.",
            },
          }));
        }
      }),
    );
  }, []);

  const hasAnyLoading = useMemo(() => Object.values(state).some((item) => item.loading), [state]);
  const computedWebhookUrl = useMemo(() => {
    const manuscriptSettings = state.manus.settings;
    const webhookBaseUrl = manuscriptSettings.find((setting) => setting.key === "webhook_url")?.value ?? "";
    const webhookSecret = manuscriptSettings.find((setting) => setting.key === "webhook_secret")?.value ?? "";
    return buildComputedWebhookUrl(webhookBaseUrl, webhookSecret);
  }, [state.manus.settings]);
  const manusProjectId = useMemo(() => {
    return state.manus.settings.find((setting) => setting.key === "project_id")?.value ?? "";
  }, [state.manus.settings]);

  const onChangeSetting = (category: Category, key: string, value: string): void => {
    setState((current) => ({
      ...current,
      [category]: {
        ...current[category],
        settings: current[category].settings.map((setting) =>
          setting.key === key ? { ...setting, value } : setting,
        ),
      },
    }));
  };

  const saveCategoryPayload = async (
    category: Category,
    settingsPayload: Record<string, string>,
  ): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      const response = await fetch(`/api/settings/${category}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ settings: settingsPayload }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        return { ok: false, error: payload?.error ?? "Failed to save" };
      }

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Save failed.",
      };
    }
  };

  const onSaveCategory = async (category: Category): Promise<void> => {
    setState((current) => ({
      ...current,
      [category]: {
        ...current[category],
        saving: true,
        error: null,
      },
    }));

    const categorySettings = getVisibleSettings(category, state[category].settings);
    const settingsPayload = Object.fromEntries(categorySettings.map((setting) => [setting.key, setting.value]));
    const result = await saveCategoryPayload(category, settingsPayload);

    if (result.ok) {
      setState((current) => ({
        ...current,
        [category]: {
          ...current[category],
          saving: false,
        },
      }));
      return;
    }

    setState((current) => ({
      ...current,
      [category]: {
        ...current[category],
        saving: false,
        error: result.error,
      },
    }));
  };

  const onSaveMarkdownSetting = async (category: Category, key: string, value: string): Promise<void> => {
    onChangeSetting(category, key, value);

    setState((current) => ({
      ...current,
      [category]: {
        ...current[category],
        saving: true,
        error: null,
      },
    }));

    const result = await saveCategoryPayload(category, { [key]: value });

    if (result.ok) {
      setState((current) => ({
        ...current,
        [category]: {
          ...current[category],
          saving: false,
        },
      }));
      setActiveMarkdownEditor(null);
      return;
    }

    setState((current) => ({
      ...current,
      [category]: {
        ...current[category],
        saving: false,
        error: result.error,
      },
    }));
  };

  if (hasAnyLoading) {
    return <p className="text-sm text-muted-foreground">Loading settings...</p>;
  }

  const activeMarkdownSetting = activeMarkdownEditor
    ? findSetting(state[activeMarkdownEditor.category].settings, activeMarkdownEditor.key)
    : null;
  const activeMarkdownConfig = activeMarkdownEditor
    ? getMarkdownConfig(activeMarkdownEditor.category, activeMarkdownEditor.key)
    : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {CATEGORIES.map(({ id, label }) => {
          const section = state[id];

          return (
            <Card key={id}>
              <CardHeader>
                <CardTitle>{label}</CardTitle>
                <Button
                  type="button"
                  disabled={section.saving}
                  onClick={() => {
                    void onSaveCategory(id);
                  }}
                >
                  {section.saving ? "Saving..." : "Save"}
                </Button>
              </CardHeader>

              {section.error ? <p className="mb-3 text-sm text-destructive">{section.error}</p> : null}

              <CardContent>
                {id === "manus" ? (
                  <div className="rounded-md border border-border bg-muted/20 p-3">
                    <p className="mb-1 text-xs uppercase tracking-[0.12em] text-muted-foreground">Project ID</p>
                    <Input readOnly value={manusProjectId} placeholder="Auto-created and managed by Agent-7" />
                    <p className="mt-2 text-xs text-muted-foreground">
                      Auto-managed field. It is created and saved when Manus project initialization succeeds.
                    </p>
                  </div>
                ) : null}
                {getVisibleSettings(id, section.settings).map((setting) => {
                  const visibilityKey = `${id}:${setting.key}`;
                  const isSecretVisible = visibleSecrets[visibilityKey] ?? false;
                  const selectOptions = getSelectOptions(id, setting.key);
                  const isSelectField = Boolean(selectOptions);
                  const markdownConfig = getMarkdownConfig(id, setting.key);

                  if (markdownConfig) {
                    const hasValue = setting.value.trim().length > 0;

                    return (
                      <div key={setting.key} className="rounded-md border border-border bg-muted/20 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="flex items-center gap-1 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                            {markdownConfig.title}
                            {markdownConfig.infoTooltip ? (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      className="inline-flex items-center text-muted-foreground hover:text-foreground"
                                      aria-label={`Info about ${markdownConfig.title}`}
                                    >
                                      <CircleHelp className="size-3.5" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-64 text-xs">{markdownConfig.infoTooltip}</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : null}
                          </p>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => {
                              setActiveMarkdownEditor({ category: id, key: setting.key });
                            }}
                          >
                            Edit
                          </Button>
                        </div>

                        {hasValue ? (
                          <div className="relative max-h-28 overflow-hidden">
                            <MarkdownContent content={setting.value} />
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-background to-transparent" />
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">{markdownConfig.emptyPlaceholder}</p>
                        )}

                        <p className="mt-3 text-xs text-muted-foreground">{markdownConfig.helpText}</p>
                      </div>
                    );
                  }

                  return (
                    <label key={setting.key} className="block">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="flex items-center gap-1 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                          {prettifyKey(setting.key)}
                          {getSettingHelpText(setting.key) ? (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    className="inline-flex items-center text-muted-foreground hover:text-foreground"
                                    aria-label={`Info about ${prettifyKey(setting.key)}`}
                                  >
                                    <CircleHelp className="size-3.5" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-64 text-xs">
                                  {getSettingHelpText(setting.key)}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : null}
                        </span>
                      </div>

                      <div className="relative">
                        {isSelectField ? (
                          <select
                            value={setting.value}
                            className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
                            onChange={(event) => {
                              onChangeSetting(id, setting.key, event.target.value);
                            }}
                          >
                            {selectOptions?.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <Input
                            className={setting.sensitive ? "pr-10" : undefined}
                            value={setting.value}
                            type={setting.sensitive && !isSecretVisible ? "password" : "text"}
                            onChange={(event) => {
                              onChangeSetting(id, setting.key, event.target.value);
                            }}
                          />
                        )}
                        {setting.sensitive && !isSelectField ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={isSecretVisible ? "Hide value" : "Show value"}
                            className="absolute right-1 top-1/2 -translate-y-1/2"
                            onClick={() => {
                              setVisibleSecrets((current) => ({
                                ...current,
                                [visibilityKey]: !isSecretVisible,
                              }));
                            }}
                          >
                            {isSecretVisible ? <EyeOff /> : <Eye />}
                          </Button>
                        ) : null}
                      </div>

                      {id === "manus" && setting.key === "webhook_url" ? (
                        <div className="mt-3">
                          <div className="mb-1 flex items-center justify-between">
                            <span className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                              Webhook URL (Read Only)
                            </span>
                          </div>
                          <div className="relative">
                            <Input
                              readOnly
                              className="pr-10"
                              value={computedWebhookUrl}
                              type={
                                (visibleSecrets["manus:computed_webhook_url"] ?? false)
                                  ? "text"
                                  : "password"
                              }
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="absolute right-1 top-1/2 -translate-y-1/2"
                              aria-label={
                                (visibleSecrets["manus:computed_webhook_url"] ?? false)
                                  ? "Hide webhook URL"
                                  : "Show webhook URL"
                              }
                              onClick={() => {
                                setVisibleSecrets((current) => ({
                                  ...current,
                                  "manus:computed_webhook_url":
                                    !(current["manus:computed_webhook_url"] ?? false),
                                }));
                              }}
                            >
                              {(visibleSecrets["manus:computed_webhook_url"] ?? false) ? <EyeOff /> : <Eye />}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </label>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <details className="rounded-xl border border-border bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium text-card-foreground">Advanced</summary>
        <div className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Bootstrap Key Generator</CardTitle>
              <Button
                type="button"
                onClick={async () => {
                  setGeneratorError(null);
                  try {
                    const response = await fetch("/api/bootstrap/encryption-key");
                    const payload = (await response.json()) as { key?: string; error?: string };
                    if (!response.ok || !payload.key) {
                      throw new Error(payload.error ?? "Failed to generate key");
                    }
                    setGeneratedDbKey(payload.key);
                  } catch (error) {
                    setGeneratorError(error instanceof Error ? error.message : "Failed to generate key");
                  }
                }}
              >
                Generate DB_ENCRYPTION_KEY
              </Button>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Use only when rotating <code>DB_ENCRYPTION_KEY</code> in <code>.env</code>.
              </p>
              {generatedDbKey ? (
                <div className="space-y-2">
                  <Input readOnly value={generatedDbKey} />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={async () => {
                        await navigator.clipboard.writeText(generatedDbKey);
                      }}
                    >
                      Copy
                    </Button>
                    <p className="text-xs text-muted-foreground">After updating .env, restart the server.</p>
                  </div>
                </div>
              ) : null}
              {generatorError ? <p className="text-sm text-destructive">{generatorError}</p> : null}
            </CardContent>
          </Card>
        </div>
      </details>

      {activeMarkdownEditor && activeMarkdownSetting && activeMarkdownConfig ? (
        <MarkdownEditorModal
          open
          title={activeMarkdownConfig.modalTitle}
          description={activeMarkdownConfig.modalDescription}
          initialValue={activeMarkdownSetting.value}
          saving={state[activeMarkdownEditor.category].saving}
          onOpenChange={(open) => {
            if (!open) {
              setActiveMarkdownEditor(null);
            }
          }}
          onSave={async (value) => {
            await onSaveMarkdownSetting(activeMarkdownEditor.category, activeMarkdownEditor.key, value);
          }}
        />
      ) : null}
    </div>
  );
}
