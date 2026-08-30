import type { Workspace } from "./api";

/** Creation availability comes from the current owner provider, never Git fields. */
export function canCreateWorkspace(workspace: Workspace | undefined): boolean {
  return workspace?.provider?.capabilities.create === true;
}
