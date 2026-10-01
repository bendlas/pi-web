import { statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { UnmappedSessionsResponse } from "../../shared/apiTypes.js";
import type { ClientSession, Project, WorkspaceListing } from "../types.js";
import { buildUnmappedSessionIndex, type UnmappedWorkspaceRoot } from "../sessions/unmappedSessionIndex.js";

/*
 * Browser-facing route for the unmapped-history index. It owns the side effects
 * (Pi listings, project/workspace catalogs, filesystem existence) and delegates
 * the classification to the pure builder in `sessions/unmappedSessionIndex`.
 */

/** Session source: every active and archived session PI WEB can list. */
export interface UnmappedSessionSource {
  listAllSessionsForIndex(): Promise<ClientSession[]>;
}

/** Project source: the registered project roots closing over their workspaces. */
export interface UnmappedProjectSource {
  list(): Promise<Project[]>;
}

/** Workspace source: the live workspace listing for one registered project. */
export interface UnmappedWorkspaceSource {
  list(project: Project): Promise<WorkspaceListing[]>;
}

export interface UnmappedSessionRouteDependencies {
  sessions: UnmappedSessionSource;
  projects: UnmappedProjectSource;
  workspaces: UnmappedWorkspaceSource;
  /** Directory existence check; overridable so route tests need no filesystem. */
  pathExists?: (cwd: string) => boolean;
  /** Clock; overridable so route tests can pin `generatedAt`. */
  now?: () => Date;
}

/** Register the unmapped-history route on the session daemon (proxied by the web tier). */
export function registerUnmappedSessionRoutes(
  app: FastifyInstance,
  dependencies: UnmappedSessionRouteDependencies,
  prefix = "",
): void {
  app.get(`${prefix}/sessions/unmapped`, async (_request, reply) => {
    try {
      return await buildUnmappedSessionsResponse(dependencies);
    } catch (error) {
      return unmappedRequestFailed(reply, error);
    }
  });
}

/** Gather every input the pure classifier needs and return the response. */
export async function buildUnmappedSessionsResponse(
  dependencies: UnmappedSessionRouteDependencies,
): Promise<UnmappedSessionsResponse> {
  const [sessions, projects] = await Promise.all([
    dependencies.sessions.listAllSessionsForIndex(),
    dependencies.projects.list(),
  ]);

  const mappedWorkspaceCwds: string[] = [];
  const workspaceContainmentRoots: UnmappedWorkspaceRoot[] = [];
  for (const project of projects) {
    workspaceContainmentRoots.push(
      { projectId: project.id, path: project.path },
      { projectId: project.id, path: defaultWorktreeParentDir(project.path) },
    );
    // A workspace resolution can fail (provider down, probe timeout). Falling
    // back to the project root keeps its live sessions mapped instead of
    // falsely reporting them as unmapped history.
    try {
      for (const workspace of await dependencies.workspaces.list(project)) mappedWorkspaceCwds.push(workspace.path);
    } catch {
      mappedWorkspaceCwds.push(project.path);
    }
  }

  return buildUnmappedSessionIndex({
    // Every session reached through this index is view-only: its cwd is outside
    // any live workspace, so the browser opens it through the archived read path.
    sessions: sessions.map((session) => ({ ...session, readOnly: true })),
    mappedWorkspaceCwds,
    workspaceContainmentRoots,
    pathExists: dependencies.pathExists ?? directoryExists,
    now: dependencies.now?.() ?? new Date(),
  });
}

/**
 * PI WEB's default worktree location for a project: a sibling
 * `<project>-worktrees` directory. Containment is textual, so a deleted worktree
 * still classifies as a workspace. A configured override is not consulted here;
 * treated as a follow-up.
 */
function defaultWorktreeParentDir(projectPath: string): string {
  return join(dirname(projectPath), `${basename(projectPath)}-worktrees`);
}

function directoryExists(cwd: string): boolean {
  try {
    return statSync(cwd).isDirectory();
  } catch {
    return false;
  }
}

function unmappedRequestFailed(reply: FastifyReply, error: unknown): FastifyReply {
  const message = error instanceof Error ? error.message : String(error);
  return reply.code(503).send({ error: `Unmapped session index unavailable: ${message}` });
}
