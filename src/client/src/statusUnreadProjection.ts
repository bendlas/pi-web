import { CORE_STATUS_FLAGS, type MachineStatusSnapshot, type StatusFlags } from "../../shared/machineStatus";
import type { Workspace } from "./api";

/**
 * Roll the keep-unread pins up into the machine status tree, so each workspace,
 * project, and the machine carries `unread` whenever a pinned session sits
 * below it.
 *
 * The daemon already rolls its own `core:unread` completions up into these nodes
 * server-side, so the client only has to add the browser-local keep-unread pins
 * the daemon does not know about. Each pin records the workspace and project it
 * belongs to at pin time, so the badge lights for that workspace/project/machine
 * regardless of which workspace or project is currently open — the client can't
 * re-derive ownership from `state.sessions`/`state.workspaces`, because those
 * are scoped to the selected workspace and project and would miss pins elsewhere.
 *
 * The snapshot's other flags come from the daemon and are left untouched; only
 * `unread` is added here. A node that already carries `unread` keeps it, and a
 * pin whose workspace is already flagged is a harmless no-op.
 */
export function augmentStatusSnapshotWithUnread(
  snapshot: MachineStatusSnapshot | undefined,
  keepUnread: readonly { workspaceId: string; projectId: string }[],
): MachineStatusSnapshot | undefined {
  if (snapshot === undefined || keepUnread.length === 0) return snapshot;

  const workspaceIds = new Set<string>();
  const projectIds = new Set<string>();
  for (const entry of keepUnread) {
    if (entry.workspaceId !== "") workspaceIds.add(entry.workspaceId);
    if (entry.projectId !== "") projectIds.add(entry.projectId);
  }
  if (workspaceIds.size === 0 && projectIds.size === 0) return snapshot;

  const unread: StatusFlags = { [CORE_STATUS_FLAGS.unread]: true };
  const hasUnread = (flags: StatusFlags | undefined): boolean => flags?.[CORE_STATUS_FLAGS.unread] === true;
  // Only rebuild the tree when some node would actually gain the flag; if the
  // daemon already flagged every owner, the snapshot is correct as-is and we
  // return it unchanged so callers can skip re-rendering.
  const needsWorkspace = [...workspaceIds].some((id) => !hasUnread(snapshot.workspaces[id]));
  const needsProject = [...projectIds].some((id) => !hasUnread(snapshot.projects[id]));
  const needsMachine = !hasUnread(snapshot.machine);
  if (!needsWorkspace && !needsProject && !needsMachine) return snapshot;

  const nextWorkspaces = { ...snapshot.workspaces };
  for (const workspaceId of workspaceIds) {
    nextWorkspaces[workspaceId] = { ...(nextWorkspaces[workspaceId] ?? {}), ...unread };
  }
  const nextProjects = { ...snapshot.projects };
  for (const projectId of projectIds) {
    nextProjects[projectId] = { ...(nextProjects[projectId] ?? {}), ...unread };
  }
  const nextMachine = needsMachine ? { ...snapshot.machine, ...unread } : snapshot.machine;
  return { ...snapshot, machine: nextMachine, projects: nextProjects, workspaces: nextWorkspaces, unattributed: snapshot.unattributed };
}

/** Resolve a working directory to the deepest containing workspace, mirroring the daemon's `WorkspaceAttribution`. */
export function attributeCwd(cwd: string, workspaces: readonly Workspace[]): { workspaceId: string; projectId: string } | undefined {
  let best: Workspace | undefined;
  let bestDepth = -1;
  for (const workspace of workspaces) {
    if (!cwdContains(workspace.path, cwd)) continue;
    const depth = workspace.path.split(/[\\/]+/).filter((segment) => segment !== "").length;
    if (depth > bestDepth) {
      best = workspace;
      bestDepth = depth;
    }
  }
  return best === undefined ? undefined : { workspaceId: best.id, projectId: best.projectId };
}

/**
 * Segment-aware containment, so `/srv/wt1` never claims `/srv/wt10`. Mirrors the
 * daemon's `containsCwd` without `node:path`, which is unavailable in the browser.
 */
function cwdContains(workspacePath: string, cwd: string): boolean {
  const parent = workspacePath.replace(/[\\/]+$/, "");
  const child = cwd.replace(/[\\/]+$/, "");
  if (parent === "" || child === "") return false;
  return child === parent || child.startsWith(`${parent}/`) || child.startsWith(`${parent}\\`);
}
