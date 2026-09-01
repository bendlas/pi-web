import type { WorkspaceProviderAuthorityResolution } from "../../shared/apiTypes.js";
import type { SessionEventHub } from "../realtime/sessionEventHub.js";
import type { Project } from "../types.js";
import type { ProjectService } from "../projects/projectService.js";
import type { WorkspaceProviderRegistry } from "./workspaceProviderRegistry.js";

const DEFAULT_WORKSPACE_TOPOLOGY_INTERVAL_MS = 5000;

export interface WorkspaceTopologyWatcherLogger {
  warn(details: Record<string, unknown>, message: string): void;
}

export interface WorkspaceTopologyWatcherOptions {
  eventHub: SessionEventHub;
  projects: ProjectService;
  catalog: WorkspaceProviderRegistry;
  intervalMs?: number;
  logger?: WorkspaceTopologyWatcherLogger;
}

/**
 * Surfaces externally-driven workspace topology changes (a Git worktree created
 * or removed outside PI WEB, a branch switch, and so on) as a realtime
 * `workspaces.changed` event so the browser re-reads the affected project's
 * workspace list without a manual reload.
 *
 * The workspace catalog is owned by a plugin (e.g. the Git worktree provider),
 * which re-enumerates on every query and does not push change notifications. So
 * this watcher polls `resolveProject` per known project on an interval, diffs the
 * listing against the last seen signature, and emits for any project whose
 * topology changed. The first pass only primes the baseline, so projects already
 * present at startup never emit.
 */
export class WorkspaceTopologyWatcher {
  private readonly eventHub: SessionEventHub;
  private readonly projects: ProjectService;
  private readonly catalog: WorkspaceProviderRegistry;
  private readonly intervalMs: number;
  private readonly logger: WorkspaceTopologyWatcherLogger;
  private readonly lastSignatures = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private scanning = false;

  constructor(options: WorkspaceTopologyWatcherOptions) {
    this.eventHub = options.eventHub;
    this.projects = options.projects;
    this.catalog = options.catalog;
    this.intervalMs = options.intervalMs ?? DEFAULT_WORKSPACE_TOPOLOGY_INTERVAL_MS;
    this.logger = options.logger ?? { warn: () => undefined };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    // Prime against the current state immediately; subsequent ticks diff.
    void this.scan().catch(() => undefined);
    this.timer = setInterval(() => {
      void this.scan().catch(() => undefined);
    }, this.intervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** One diff pass over every known project. Public so callers/tests can trigger a pass without the interval.
   *
   *  A single pass can take longer than the poll interval: each project is resolved through the
   *  workspace catalog, and a resolution runs a probe plus a list as bounded provider operations that
   *  may each take seconds. `setInterval` fires regardless of whether the previous pass finished, so
   *  without the `scanning` guard passes would start on top of one another. Each in-flight pass holds a
   *  full workspace listing and spawns provider work, so overlapped passes pile up and the daemon's
   *  memory and CPU grow without bound. The guard coalesces: a pass that is still running makes the
   *  next tick (or manual call) a no-op, so at most one pass is ever in flight. */
  async scan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      await this.runScan();
    } finally {
      this.scanning = false;
    }
  }

  private async runScan(): Promise<void> {
    let projects: Project[];
    try {
      projects = await this.projects.list();
    } catch (error) {
      this.logger.warn({ err: String(error) }, "workspace topology watch: failed to list projects");
      return;
    }
    const currentIds = new Set(projects.map((project) => project.id));
    for (const id of [...this.lastSignatures.keys()]) {
      if (!currentIds.has(id)) this.lastSignatures.delete(id);
    }
    for (const project of projects) {
      let resolution: WorkspaceProviderAuthorityResolution;
      try {
        resolution = await this.catalog.resolve(project);
      } catch (error) {
        this.logger.warn({ projectId: project.id, err: String(error) }, "workspace topology watch: failed to resolve project workspaces");
        continue;
      }
      const signature = workspaceSignature(resolution.workspaces);
      const previous = this.lastSignatures.get(project.id);
      if (previous === undefined) {
        this.lastSignatures.set(project.id, signature);
        continue;
      }
      if (previous !== signature) {
        this.lastSignatures.set(project.id, signature);
        this.eventHub.publishGlobal({ type: "workspaces.changed", projectId: project.id });
      }
    }
  }
}

/** Stable, order-sensitive signature of the browser-visible topology of a workspace listing. */
function workspaceSignature(workspaces: readonly { id: string; path: string; label: string; isMain: boolean }[]): string {
  return workspaces
    .map((workspace) => JSON.stringify([workspace.id, workspace.path, workspace.label, workspace.isMain]))
    .join("\n");
}
