"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Activity, Bot, Cable, FileText, Settings2, Waypoints } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

type SidebarTask = {
  taskId: string;
  status: "pending" | "running" | "completed" | "failed" | "waiting_user";
  taskTitle: string | null;
  lastMessage: string | null;
  updatedAt: string;
};

const navItems = [
  { href: "/guide", label: "Guide", icon: FileText },
  { href: "/channels", label: "Channels", icon: Cable },
  { href: "/config", label: "Config", icon: Settings2 },
  { href: "/tunnel", label: "Tunnel", icon: Waypoints },
  { href: "/status", label: "Status", icon: Activity },
];

const statusLabel: Record<SidebarTask["status"], string> = {
  pending: "PENDING",
  running: "RUNNING",
  completed: "DONE",
  failed: "FAILED",
  waiting_user: "WAITING",
};

function formatTaskTitle(task: SidebarTask): string {
  return task.taskTitle?.trim() || task.lastMessage?.trim() || task.taskId;
}

export function DashboardSidebar({ tasks }: { tasks: SidebarTask[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTaskId = searchParams.get("task");
  const onTasksPage = pathname === "/";

  return (
    <Sidebar className="border-r border-sidebar-border" collapsible="icon">
      <SidebarHeader className="gap-3 border-b border-sidebar-border px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground">
            <Bot className="size-4" />
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-xs uppercase tracking-[0.14em] text-muted-foreground">Agent Console</p>
            <p className="truncate text-sm font-medium">Workspace</p>
          </div>
        </div>
        <SidebarMenu>
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
                  <Link href={item.href}>
                    <item.icon />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Manus Tasks</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {tasks.map((task, index) => {
                const isDefaultSelection = !currentTaskId && index === 0;
                const isActive = onTasksPage && (currentTaskId === task.taskId || isDefaultSelection);
                return (
                  <SidebarMenuItem key={task.taskId}>
                    <SidebarMenuButton asChild isActive={isActive} tooltip={formatTaskTitle(task)} className="pr-14">
                      <Link href={`/?task=${encodeURIComponent(task.taskId)}`}>
                        <span className="truncate">{formatTaskTitle(task)}</span>
                      </Link>
                    </SidebarMenuButton>
                    <SidebarMenuBadge className="text-[10px]">{statusLabel[task.status]}</SidebarMenuBadge>
                  </SidebarMenuItem>
                );
              })}
              {tasks.length === 0 ? (
                <SidebarMenuItem>
                  <SidebarMenuButton disabled>
                    <span>No tasks yet</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : null}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
