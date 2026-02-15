import Link from "next/link";

const navItems = [
  { href: "/guide", label: "Guide" },
  { href: "/channels", label: "Channels" },
  { href: "/config", label: "Config" },
  { href: "/tunnel", label: "Tunnel" },
  { href: "/status", label: "Status" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl gap-6 px-6 py-8">
        <aside className="w-64 shrink-0 rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
          <div className="mb-6">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Agent Console</p>
            <h1 className="mt-2 text-xl font-semibold text-white">Workspace Settings</h1>
          </div>
          <nav className="space-y-2">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block rounded-lg px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800 hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">{children}</main>
      </div>
    </div>
  );
}
