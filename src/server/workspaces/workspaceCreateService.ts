import type { CreateWorkspaceRequest, WorkspaceListing } from "../../shared/apiTypes.js";
import type { Project } from "../types.js";
import { WorkspaceProviderCreateError } from "./workspaceProviderRegistry.js";

export interface WorkspaceCreator {
  createWorkspace(
    project: Project,
    input: CreateWorkspaceRequest,
    worktreeParentDir: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceListing>;
}

/**
 * Sessiond-owned creation orchestration. The host resolves the configured
 * worktree parent directory and the provider creates the native worktree; the
 * host retains generic path safety and provider operation timeouts.
 */
export class WorkspaceCreateService {
  constructor(
    private readonly providers: WorkspaceCreator,
    private readonly resolveWorktreeParentDir: (project: Project) => Promise<string>,
  ) {}

  async create(
    project: Project,
    input: CreateWorkspaceRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceListing> {
    const worktreeParentDir = await this.resolveWorktreeParentDir(project);
    return await this.providers.createWorkspace(project, input, worktreeParentDir, signal);
  }
}

export function workspaceCreationHttpStatus(error: unknown, fallback = 500): number {
  if (error instanceof WorkspaceProviderCreateError) return error.statusCode;
  return fallback;
}
