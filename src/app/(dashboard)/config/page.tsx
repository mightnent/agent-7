import { ConfigEditor } from "./settings-editor";

export default function ConfigPage() {
  return (
    <section className="space-y-4">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Manage</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">Configuration</h2>
        <p className="mt-2 text-sm text-slate-300">
          Settings are loaded from the workspace database first, then environment fallbacks.
        </p>
      </header>
      <ConfigEditor />
    </section>
  );
}
