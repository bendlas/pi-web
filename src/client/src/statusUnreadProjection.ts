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

type MutableFlags = Record<string, boolean>;
const unreadFlag = (): MutableFlags => ({ [CORE_STATUS_FLAGS.unread]: true });
const hasUnread = (flags: StatusFlags | undefined): boolean => flags?.[CORE_STATUS_FLAGS.unread] === true;
/** Copy `flags` without the `unread` marker, so a corrected node omits it entirely. */
const withoutUnread = (flags: StatusFlags): MutableFlags => {
  const next: MutableFlags = {};
  for (const key of Object.keys(flags)) {
    if (key !== CORE_STATUS_FLAGS.unread) next[key] = flags[key] === true;
  }
  return next;
};

/**
 * The daemon rolls `core:unread` up the workspace tree by working directory, which
 * can light a workspace/project for a session the client can no longer show — for
 * example an orphaned unread record whose worktree was deleted, or a session that is
 * no longer a member of the workspace it is attributed to. The badge then stays lit
 * with no session row justifying it. The client can validate the *selected* workspace
 * (it holds that workspace's sessions), so when the selected workspace carries no
 * visible unread session and no keep-unread pin owns it, drop its `unread` flag and
 * recompute the owning project and the machine from the corrected tree.
 *
 * Only the selected workspace is corrected: the client cannot see other workspaces'
 * sessions, so their daemon unread is left untouched. This matches the principle the
 * keep-unread pins already follow — a node is unread only when something visible
 * actually carries the marker.
 */
export function reconcileVisibleUnread(
  snapshot: MachineStatusSnapshot | undefined,
  selectedWorkspaceId: string,
  workspacesByProjectId: Record<string, readonly { id: string; projectId: string }[]>,
  selectedWorkspaceJustified: boolean,
): MachineStatusSnapshot | undefined {
  if (snapshot === undefined || selectedWorkspaceId === "" || selectedWorkspaceJustified) return snapshot;
  const workspaceFlags = snapshot.workspaces[selectedWorkspaceId];
  if (workspaceFlags === undefined || !hasUnread(workspaceFlags)) return snapshot;

  const workspaces: Record<string, MutableFlags> = { ...snapshot.workspaces };
  workspaces[selectedWorkspaceId] = withoutUnread(workspaceFlags);

  const projects: Record<string, MutableFlags> = { ...snapshot.projects };
  const projectId = Object.entries(workspacesByProjectId).find(([, list]) =>
    list.some((workspace) => workspace.id === selectedWorkspaceId),
  )?.[0];
  if (projectId !== undefined) {
    const projectUnread = (workspacesByProjectId[projectId] ?? []).some(
      (workspace) => hasUnread(workspaces[workspace.id]),
    );
    projects[projectId] = projectUnread ? { ...(projects[projectId] ?? {}), ...unreadFlag() } : withoutUnread(projects[projectId] ?? {});
  }

  const machineUnread =
    Object.values(workspaces).some(hasUnread)
    || Object.values(projects).some(hasUnread)
    || hasUnread(snapshot.unattributed);
  const machine: MutableFlags = machineUnread ? { ...snapshot.machine, ...unreadFlag() } : withoutUnread(snapshot.machine);

  return { ...snapshot, machine, projects, workspaces, unattributed: snapshot.unattributed };
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
