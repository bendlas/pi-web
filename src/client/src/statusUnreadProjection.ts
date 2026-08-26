import { CORE_STATUS_FLAGS, type MachineStatusSnapshot, type StatusFlags } from "../../shared/machineStatus";
import type { SessionInfo, Workspace } from "./api";

/**
 * Roll a set of unread session ids up into the machine status tree, so each
 * workspace, project, and the machine carries `unread` whenever an unread
 * session sits below it.
 *
 * The client owns unread as a single set — daemon completions unioned with the
 * browser-local keep-unread pins, exposed as `unreadSessionIds`. The daemon's
 * status tree only knows about the daemon half, so workspace and project badges
 * go dark the moment a kept-unread conversation is read server-side. Deriving
 * the tree's `unread` flag from that one session-level set keeps every badge in
 * lock-step with the session rows, with no second unread model to keep in sync.
 *
 * The snapshot's other flags come from the daemon and are left untouched; only
 * `unread` is re-derived here. A node that already carries `unread` keeps it, and
 * a session whose workspace is already flagged is a harmless no-op.
 */
export function augmentStatusSnapshotWithUnread(
  snapshot: MachineStatusSnapshot | undefined,
  unreadSessionIds: ReadonlySet<string>,
  sessions: readonly SessionInfo[],
  workspaces: readonly Workspace[],
): MachineStatusSnapshot | undefined {
  if (snapshot === undefined || unreadSessionIds.size === 0) return snapshot;

  const byId = new Map(sessions.map((session) => [session.id, session]));
  const workspaceIds = new Set<string>();
  const projectIds = new Set<string>();
  let unattributed = false;
  for (const id of unreadSessionIds) {
    const session = byId.get(id);
    if (session === undefined) continue;
    const owner = attributeCwd(session.cwd, workspaces);
    if (owner === undefined) unattributed = true;
    else {
      workspaceIds.add(owner.workspaceId);
      projectIds.add(owner.projectId);
    }
  }

  if (workspaceIds.size === 0 && projectIds.size === 0 && !unattributed) return snapshot;

  const unread: StatusFlags = { [CORE_STATUS_FLAGS.unread]: true };
  const hasUnread = (flags: StatusFlags | undefined): boolean => flags?.[CORE_STATUS_FLAGS.unread] === true;
  // Only rebuild the tree when some node would actually gain the flag; if the
  // daemon already flagged every owner, the snapshot is correct as-is and we
  // return it unchanged so callers can skip re-rendering.
  const needsWorkspace = [...workspaceIds].some((id) => !hasUnread(snapshot.workspaces[id]));
  const needsProject = [...projectIds].some((id) => !hasUnread(snapshot.projects[id]));
  const needsUnattributed = unattributed && !hasUnread(snapshot.unattributed);
  const needsMachine = !hasUnread(snapshot.machine);
  if (!needsWorkspace && !needsProject && !needsUnattributed && !needsMachine) return snapshot;

  const nextWorkspaces = { ...snapshot.workspaces };
  for (const workspaceId of workspaceIds) {
    nextWorkspaces[workspaceId] = { ...(nextWorkspaces[workspaceId] ?? {}), ...unread };
  }
  const nextProjects = { ...snapshot.projects };
  for (const projectId of projectIds) {
    nextProjects[projectId] = { ...(nextProjects[projectId] ?? {}), ...unread };
  }
  const nextUnattributed = needsUnattributed ? { ...snapshot.unattributed, ...unread } : snapshot.unattributed;
  const nextMachine = needsMachine ? { ...snapshot.machine, ...unread } : snapshot.machine;
  return { ...snapshot, machine: nextMachine, projects: nextProjects, workspaces: nextWorkspaces, unattributed: nextUnattributed };
}

/** Resolve a working directory to the deepest containing workspace, mirroring the daemon's `WorkspaceAttribution`. */
function attributeCwd(cwd: string, workspaces: readonly Workspace[]): { workspaceId: string; projectId: string } | undefined {
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
