import * as fs from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { WorkspaceProviderAuthorityResolution } from "../../shared/apiTypes.js";
import type { SessionEventHub } from "../realtime/sessionEventHub.js";
import type { Project } from "../types.js";
import type { ProjectService } from "../projects/projectService.js";
import type { WorkspaceProviderRegistry } from "./workspaceProviderRegistry.js";

const DEFAULT_WORKSPACE_TOPOLOGY_INTERVAL_MS = 5000;
/** Collapse the burst of fs events a single `git worktree add`/`remove` emits into one rescan. */
const PROJECT_WATCH_DEBOUNCE_MS = 150;

export interface WorkspaceTopologyWatcherLogger {
  warn(details: Record<string, unknown>, message: string): void;
}

export interface WorkspaceTopologyWatcherOptions {
  eventHub: SessionEventHub;
  projects: ProjectService;
  catalog: WorkspaceProviderRegistry;
  /**
   * How often to reconcile the *set* of watched projects (cheap: project ids
   * only, no resolve). Real topology changes are caught by the per-project git
   * file watch, so this interval only needs to pick up projects added or removed
   * between watches. Defaults to 5s.
   */
  intervalMs?: number;
  logger?: WorkspaceTopologyWatcherLogger;
  /**
   * Called after a project's workspace topology actually changed (the same
   * event that publishes `workspaces.changed`), so caches derived from the
   * workspace listing can be dropped without re-polling every listing. This is
   * the inotify-driven invalidation path: the git worktree file watches are
   * the only source, so a cache refresh only happens on a real change.
   */
  onTopologyChanged?: (projectId: string) => void;
}

/**
 * Surfaces externally-driven workspace topology changes (a Git worktree created
 * or removed outside PI WEB, a branch switch, and so on) as a realtime
 * `workspaces.changed` event so the browser re-reads the affected project's
 * workspace list without a manual reload.
 *
 * The workspace catalog is owned by a plugin (e.g. the Git worktree provider),
 * which re-enumerates on every query and does not push change notifications. So
 * this watcher used to poll `resolveProject` per known project on an interval,
 * diffing the listing against the last seen signature. That full resolve of
 * every project on every tick was the source of periodic CPU and memory spikes.
 *
 * Now the watcher is event-driven: it arms an `fs.watch` on each project's git
 * worktree registry (`.git/worktrees`, watched recursively, plus `.git/HEAD`
 * for the main worktree's branch) and re-resolves only the one project whose
 * watch fired. A cheap, resolve-free interval only reconciles the set of
 * watched projects (picking up projects added or removed), so the expensive
 * `resolve` runs only when a topology actually changes.
 */
export class WorkspaceTopologyWatcher {
  private readonly eventHub: SessionEventHub;
  private readonly projects: ProjectService;
  private readonly catalog: WorkspaceProviderRegistry;
  private readonly intervalMs: number;
  private readonly logger: WorkspaceTopologyWatcherLogger;
  private readonly onTopologyChanged: (projectId: string) => void;
  private readonly lastSignatures = new Map<string, string>();
  private readonly projectWatchers = new Map<string, fs.FSWatcher[]>();
  private readonly projectScanning = new Set<string>();
  private readonly projectDebounce = new Map<string, ReturnType<typeof setTimeout>>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private scanning = false;

  constructor(options: WorkspaceTopologyWatcherOptions) {
    this.eventHub = options.eventHub;
    this.projects = options.projects;
    this.catalog = options.catalog;
    this.intervalMs = options.intervalMs ?? DEFAULT_WORKSPACE_TOPOLOGY_INTERVAL_MS;
    this.logger = options.logger ?? { warn: () => undefined };
    this.onTopologyChanged = options.onTopologyChanged ?? (() => undefined);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    // Prime signatures against the current state and arm a file watch per project.
    void this.initialScan().catch(() => undefined);
    // Cheap reconcile of the watched project set (no per-project resolve).
    this.timer = setInterval(() => {
      void this.reconcileProjects().catch(() => undefined);
    }, this.intervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    for (const watchers of this.projectWatchers.values()) this.closeWatchers(watchers);
    this.projectWatchers.clear();
    for (const handle of this.projectDebounce.values()) clearTimeout(handle);
    this.projectDebounce.clear();
    this.projectScanning.clear();
  }

  /** Full diff pass over every known project. Public so callers/tests can trigger a pass without the interval. */
  async scan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      await this.runScan();
    } finally {
      this.scanning = false;
    }
  }

  /**
   * Re-resolve a single project and emit `workspaces.changed` if its topology
   * changed. The per-project git file watch calls this (debounced) when it sees a
   * change. It coalesces: a rescan already in flight for the same project makes
   * another trigger a no-op, so a burst of fs events resolves the project at most
   * once. This is what keeps the per-tick cost near zero — the full `resolve` only
   * runs when a project's topology actually changed.
   */
  async scanProject(project: Project): Promise<void> {
    if (this.projectScanning.has(project.id)) return;
    this.projectScanning.add(project.id);
    try {
      let resolution: WorkspaceProviderAuthorityResolution;
      try {
        resolution = await this.catalog.resolve(project);
      } catch (error) {
        this.logger.warn({ projectId: project.id, err: String(error) }, "workspace topology watch: failed to resolve project workspaces");
        return;
      }
      const signature = workspaceSignature(resolution.workspaces);
      const previous = this.lastSignatures.get(project.id);
      if (previous === undefined) {
        this.lastSignatures.set(project.id, signature);
        return;
      }
      if (previous !== signature) {
        this.lastSignatures.set(project.id, signature);
        this.onTopologyChanged(project.id);
        this.eventHub.publishGlobal({ type: "workspaces.changed", projectId: project.id });
      }
    } finally {
      this.projectScanning.delete(project.id);
    }
  }

  private async initialScan(): Promise<void> {
    let projects: Project[];
    try {
      projects = await this.projects.list();
    } catch (error) {
      this.logger.warn({ err: String(error) }, "workspace topology watch: failed to list projects");
      return;
    }
    for (const project of projects) this.setupProjectWatch(project);
    await this.scan();
  }

  /** Cheap reconcile of the watched project set: list project ids and arm/tear down watches.
   *  Deliberately does not resolve workspaces — that only happens on a real git change. */
  private async reconcileProjects(): Promise<void> {
    let projects: Project[];
    try {
      projects = await this.projects.list();
    } catch (error) {
      this.logger.warn({ err: String(error) }, "workspace topology watch: failed to list projects");
      return;
    }
    const ids = new Set(projects.map((project) => project.id));
    for (const id of [...this.projectWatchers.keys()]) {
      if (!ids.has(id)) {
        const watchers = this.projectWatchers.get(id);
        if (watchers !== undefined) this.closeWatchers(watchers);
        this.projectWatchers.delete(id);
        this.lastSignatures.delete(id);
        const handle = this.projectDebounce.get(id);
        if (handle !== undefined) {
          clearTimeout(handle);
          this.projectDebounce.delete(id);
        }
        this.projectScanning.delete(id);
      }
    }
    for (const project of projects) {
      if (!this.projectWatchers.has(project.id)) this.setupProjectWatch(project);
    }
  }

  private setupProjectWatch(project: Project): void {
    if (project.path === undefined) {
      this.projectWatchers.set(project.id, []);
      return;
    }
    const mainGitDir = resolveMainGitDir(project.path);
    if (mainGitDir === undefined) {
      this.projectWatchers.set(project.id, []);
      return;
    }
    const watchers: fs.FSWatcher[] = [];
    try {
      const worktreesDir = join(mainGitDir, "worktrees");
      ensureDir(worktreesDir);
      watchers.push(this.watch(worktreesDir, project));
      // The main worktree's branch lives in <mainGitDir>/HEAD; a linked worktree's branch is
      // under .git/worktrees/<name>/HEAD (already covered by the recursive worktrees watch).
      if (mainGitDir === join(project.path, ".git")) {
        const head = join(mainGitDir, "HEAD");
        if (fs.existsSync(head)) watchers.push(this.watch(head, project));
      }
    } catch (error) {
      this.logger.warn({ projectId: project.id, err: String(error) }, "workspace topology watch: failed to watch project git");
    }
    this.projectWatchers.set(project.id, watchers);
  }

  private watch(target: string, project: Project): fs.FSWatcher {
    const watcher = fs.watch(target, { recursive: true }, () => this.onGitEvent(project));
    watcher.on("error", (error) => {
      this.logger.warn({ projectId: project.id, err: String(error) }, "workspace topology watch: watch error");
      this.closeWatchers([watcher]);
      this.projectWatchers.delete(project.id);
    });
    return watcher;
  }

  private onGitEvent(project: Project): void {
    const existing = this.projectDebounce.get(project.id);
    if (existing !== undefined) clearTimeout(existing);
    this.projectDebounce.set(project.id, setTimeout(() => {
      this.projectDebounce.delete(project.id);
      void this.scanProject(project);
    }, PROJECT_WATCH_DEBOUNCE_MS));
  }

  private closeWatchers(watchers: fs.FSWatcher[]): void {
    for (const watcher of watchers) {
      try {
        watcher.close();
      } catch {
        // A watcher that already errored out closes itself; ignore.
      }
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
      await this.scanProject(project);
    }
  }
}

/** Stable, order-sensitive signature of the browser-visible topology of a workspace listing. */
function workspaceSignature(workspaces: readonly { id: string; path: string; label: string; isMain: boolean }[]): string {
  return workspaces
    .map((workspace) => JSON.stringify([workspace.id, workspace.path, workspace.label, workspace.isMain]))
    .join("\n");
}

/**
 * Resolve the main repository's `.git` directory for a project so its worktree
 * registry can be watched. For a main worktree the `.git` is a directory; for a
 * linked worktree it is a `gitdir:` pointer file whose target is
 * `<main>/.git/worktrees/<name>`, so the main repo git dir is two levels up from it.
 */
function resolveMainGitDir(projectPath: string): string | undefined {
  const gitPath = join(projectPath, ".git");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(gitPath);
  } catch {
    return undefined;
  }
  if (stat.isDirectory()) return gitPath;
  let content: string;
  try {
    content = fs.readFileSync(gitPath, "utf8");
  } catch {
    return undefined;
  }
  const match = content.match(/^gitdir:\s*(.+)$/m);
  if (match === null) return undefined;
  const gitdir = match[1];
  if (gitdir === undefined) return undefined;
  const resolved = isAbsolute(gitdir) ? gitdir : resolve(projectPath, gitdir);
  return dirname(dirname(resolved));
}

function ensureDir(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Best effort: the watch below will simply fail to arm and the project
    // reconciles again on the next tick.
  }
}
