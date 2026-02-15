import { DEFAULT_WORKSPACE_ID } from "@/db/schema";

export const resolveWorkspaceId = (): string => {
  return DEFAULT_WORKSPACE_ID;
};
