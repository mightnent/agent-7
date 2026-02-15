import { redirect } from "next/navigation";

export default function DashboardIndexPage(): never {
  redirect("/config");
}
