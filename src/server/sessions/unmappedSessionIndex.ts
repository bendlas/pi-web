import { isAbsolute, relative, resolve, sep } from "node:path";
import type {
  UnmappedSessionGroup,
  UnmappedSessionGroupKind,
  UnmappedSessionsResponse,
} from "../../shared/apiTypes.js";
import type { ClientSession } from "../types.js";

/*
 * UNMAPPED SESSION INDEX
 *
 * Pi's session store knows every persisted transcript's cwd but nothing about
 * PI WEB's notion of a project or workspace. This module performs the missing
 * join: it takes every session PI WEB can list (the live Pi stores plus archived
 * records), drops the cwds that a registered project/workspace currently
 * exposes, and groups the remainder by their recorded cwd.
 *
 * It is deliberately pure — all reads (Pi listings, project/workspace catalogs,
 * filesystem existence) happen in the caller — so the classification can be
 * tested without a daemon, the filesystem, or the Pi SDK.
 */

/**
 * One containment root: a registered project's own path or a worktree parent
 * directory it creates. The project id is echoed onto the workspace groups so
 * the client can scope them to the open project.
 */
export interface UnmappedWorkspaceRoot {
  projectId: string;
  path: string;
}

/** Inputs for {@link buildUnmappedSessionIndex}. */
export interface UnmappedSessionIndexInput {
  /** Every session PI WEB can list, active and archived. */
  sessions: readonly ClientSession[];
  /**
   * Workspace cwd paths currently reachable through a registered project. A
   * session whose cwd matches one of these is a live, normally-listed session
   * and is excluded.
   */
  mappedWorkspaceCwds: readonly string[];
  /**
   * Roots under which an unmapped cwd is considered a workspace rather than a
   * project: each registered project's own path plus the parent directories it
   * creates worktrees in. Containment is textual, so a deleted directory still
   * classifies by where it used to live.
   */
  workspaceContainmentRoots: readonly UnmappedWorkspaceRoot[];
  /** True when the directory still exists; used for the deleted/unmapped badge. */
  pathExists: (cwd: string) => boolean;
  /** Timestamp stamped onto the response, injected for deterministic tests. */
  now: Date;
}

/** Group one cwd's sessions into the response shape. */
export function buildUnmappedSessionIndex(input: UnmappedSessionIndexInput): UnmappedSessionsResponse {
  const mapped = new Set(input.mappedWorkspaceCwds.filter((cwd) => cwd !== "").map((cwd) => resolve(cwd)));
  const roots = input.workspaceContainmentRoots
    .filter((root) => root.path !== "")
    .map((root) => ({ projectId: root.projectId, path: resolve(root.path) }));
  const sessionsByCwd = new Map<string, ClientSession[]>();

  for (const session of input.sessions) {
    // Empty cwds (legacy records) cannot match a workspace and are kept so their
    // transcripts stay reachable; they are grouped under a synthetic "" entry.
    if (session.cwd !== "" && mapped.has(resolve(session.cwd))) continue;
    const bucket = sessionsByCwd.get(session.cwd);
    if (bucket === undefined) sessionsByCwd.set(session.cwd, [session]);
    else bucket.push(session);
  }

  const groups: UnmappedSessionGroup[] = [];
  for (const [cwd, sessions] of sessionsByCwd) {
    const root = cwd === "" ? undefined : mostSpecificRoot(roots, cwd);
    const kind: UnmappedSessionGroupKind = root === undefined ? "project" : "workspace";
    groups.push({
      cwd,
      kind,
      // Workspace groups drop the matched project/worktree prefix from their
      // display path; the row keeps `cwd` for its full-path title and key.
      ...(root === undefined ? {} : { projectId: root.projectId, relativePath: relative(root.path, resolve(cwd)) }),
      exists: cwd !== "" && input.pathExists(cwd),
      sessions: [...sessions].sort(byModifiedDesc),
    });
  }
  groups.sort(compareGroups);
  return { generatedAt: input.now.toISOString(), groups };
}

/**
 * The deepest containment root holding `child`. Overlapping roots (a project
 * inside another project, or a worktree directory nested under one) resolve to
 * the most specific path so the group is attributed to the right project.
 */
function mostSpecificRoot(roots: readonly UnmappedWorkspaceRoot[], child: string): UnmappedWorkspaceRoot | undefined {
  const resolvedChild = resolve(child);
  let best: UnmappedWorkspaceRoot | undefined;
  for (const root of roots) {
    if (!isStrictDescendant(root.path, resolvedChild)) continue;
    if (best === undefined || root.path.length > best.path.length) best = root;
  }
  return best;
}

function isStrictDescendant(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Newest first; ties broken by id so ordering is stable. */
function byModifiedDesc(a: ClientSession, b: ClientSession): number {
  return Date.parse(b.modified) - Date.parse(a.modified) || a.id.localeCompare(b.id);
}

/** Projects before workspaces, then by most recent session, then by path. */
function compareGroups(a: UnmappedSessionGroup, b: UnmappedSessionGroup): number {
  if (a.kind !== b.kind) return a.kind === "project" ? -1 : 1;
  const aAt = Date.parse(a.sessions[0]?.modified ?? "");
  const bAt = Date.parse(b.sessions[0]?.modified ?? "");
  if (aAt !== bAt) return (Number.isNaN(bAt) ? 0 : bAt) - (Number.isNaN(aAt) ? 0 : aAt);
  return a.cwd.localeCompare(b.cwd);
}
