"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleHelp, Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Category = "manus" | "router" | "connectors" | "internal" | "whatsapp";

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

const CATEGORIES: Array<{ id: Category; label: string }> = [
  { id: "manus", label: "Manus" },
  { id: "router", label: "Router" },
  { id: "connectors", label: "Connectors" },
  { id: "internal", label: "Internal" },
  { id: "whatsapp", label: "WhatsApp" },
];

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

export function ConfigEditor() {
  const [state, setState] = useState<Record<Category, CategoryState>>(createInitialState);
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});
  const [generatedDbKey, setGeneratedDbKey] = useState<string>("");
  const [generatorError, setGeneratorError] = useState<string | null>(null);

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

  const onSaveCategory = async (category: Category): Promise<void> => {
    setState((current) => ({
      ...current,
      [category]: {
        ...current[category],
        saving: true,
        error: null,
      },
    }));

    try {
      const categorySettings = getVisibleSettings(category, state[category].settings);
      const settingsPayload = Object.fromEntries(
        categorySettings.map((setting) => [setting.key, setting.value]),
      );

      const response = await fetch(`/api/settings/${category}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ settings: settingsPayload }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Failed to save");
      }

      setState((current) => ({
        ...current,
        [category]: {
          ...current[category],
          saving: false,
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Save failed.";
      setState((current) => ({
        ...current,
        [category]: {
          ...current[category],
          saving: false,
          error: message,
        },
      }));
    }
  };

  if (hasAnyLoading) {
    return <p className="text-sm text-muted-foreground">Loading settings...</p>;
  }

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
              {getVisibleSettings(id, section.settings).map((setting) => {
                const visibilityKey = `${id}:${setting.key}`;
                const isSecretVisible = visibleSecrets[visibilityKey] ?? false;
                const selectOptions = getSelectOptions(id, setting.key);
                const isSelectField = Boolean(selectOptions);

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
    </div>
  );
}
