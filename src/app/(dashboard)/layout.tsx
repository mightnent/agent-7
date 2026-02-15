import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { DrizzleReadApiStore } from "@/lib/ops/read-api.store";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const store = new DrizzleReadApiStore();
  const tasks = await store.listSidebarTasks(50);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SidebarProvider>
        <DashboardSidebar
          tasks={tasks.map((task) => ({
            ...task,
            updatedAt: task.updatedAt.toISOString(),
          }))}
        />
        <SidebarInset className="border-l border-border/70">
          <header className="sticky top-0 z-30 flex h-14 items-center border-b border-border/70 bg-background/90 px-4 backdrop-blur">
            <SidebarTrigger className="mr-2" />
            <p className="text-sm font-medium text-muted-foreground">Manus Task Console</p>
          </header>
          <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
