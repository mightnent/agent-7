"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

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

const prettifyKey = (key: string): string => {
  return key
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
};

const createInitialState = (): Record<Category, CategoryState> => ({
  manus: { loading: true, saving: false, error: null, settings: [] },
  router: { loading: true, saving: false, error: null, settings: [] },
  connectors: { loading: true, saving: false, error: null, settings: [] },
  internal: { loading: true, saving: false, error: null, settings: [] },
  whatsapp: { loading: true, saving: false, error: null, settings: [] },
});

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
      const categorySettings = state[category].settings;
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
              {section.settings.map((setting) => {
                const visibilityKey = `${id}:${setting.key}`;
                const isSecretVisible = visibleSecrets[visibilityKey] ?? false;

                return (
                  <label key={setting.key} className="block">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                        {prettifyKey(setting.key)}
                      </span>
                      {setting.sensitive ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setVisibleSecrets((current) => ({
                              ...current,
                              [visibilityKey]: !isSecretVisible,
                            }));
                          }}
                        >
                          {isSecretVisible ? "Hide" : "Reveal"}
                        </Button>
                      ) : null}
                    </div>

                    <Input
                      value={setting.value}
                      type={setting.sensitive && !isSecretVisible ? "password" : "text"}
                      onChange={(event) => {
                        onChangeSetting(id, setting.key, event.target.value);
                      }}
                    />
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
