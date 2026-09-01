import type { WorkspacePanelContext } from "@jmfederico/pi-web/plugin-api";
import type { WorkspaceTask } from "./config.js";
import { SCRIPTS_CONFIG_PATH } from "./workspaceTasksClient.js";
import { runWorkspaceTaskInTerminal } from "./taskRunner.js";
import {
  loadWorkspaceTasksConfig,
  tasksConfigMissingHint,
  tasksConfigMissingMessage,
  tasksConfigRefreshHint,
  tasksConfigUnavailableMessage,
  type WorkspaceTasksConfigLoadResult,
} from "./workspaceTasksClient.js";
import {
  globalTasksConfigPathLabel,
  globalTasksMissingHint,
  globalTasksMissingMessage,
  globalTasksRefreshHint,
  globalTasksUnavailableMessage,
  loadGlobalTasksConfig,
} from "./globalTasksClient.js";

export const workspaceTasksPanelTagName = "pi-web-workspace-tasks-panel";

const configChangedEvent = "pi-web-tasks-config-changed";

type ConfigState =
  | { kind: "loading" }
  | WorkspaceTasksConfigLoadResult;

interface TaskStatus {
  kind: "info" | "success" | "error";
  message: string;
  detail?: string;
}

/**
 * A panel "source" describes where a script list comes from and how it is loaded.
 * The Scripts panel combines every source into a single tab, each rendered as its
 * own section: the Workspace Scripts source reads the per-workspace
 * `.pi-web/scripts.json`, and the Global Scripts source reads the machine-wide
 * `<dataDir>/scripts.json`. A legacy `.pi-web/tasks.json` / `<dataDir>/tasks.json`
 * is still read and migrated opportunistically. Global scripts are never merged
 * with the workspace list.
 */
interface TasksPanelSource {
  readonly id: string;
  readonly panelTitle: string;
  readonly configPathLabel: string;
  readonly missingMessage: string;
  readonly missingHint: string;
  cacheKey(context: WorkspacePanelContext): string;
  load(context: WorkspacePanelContext): Promise<WorkspaceTasksConfigLoadResult>;
}

const workspaceTasksSource: TasksPanelSource = {
  id: "workspace",
  panelTitle: "Workspace Scripts",
  configPathLabel: SCRIPTS_CONFIG_PATH,
  missingMessage: tasksConfigMissingMessage,
  missingHint: tasksConfigMissingHint,
  cacheKey: (context) => cacheKeyForContext(context),
  load: (context) => loadWorkspaceTasksConfig(context.files),
};

const globalTasksSource: TasksPanelSource = {
  id: "global",
  panelTitle: "Global Scripts",
  configPathLabel: globalTasksConfigPathLabel,
  missingMessage: globalTasksMissingMessage,
  missingHint: globalTasksMissingHint,
  cacheKey: (context) => `global:${context.machine.id}`,
  load: () => loadGlobalTasksConfig(),
};

const taskSources: readonly TasksPanelSource[] = [workspaceTasksSource, globalTasksSource];

const configCache = new Map<string, ConfigState>();

function cacheKeyForSource(source: TasksPanelSource, context: WorkspacePanelContext): string {
  return `${source.id}:${source.cacheKey(context)}`;
}

export function defineTasksPanelElement(): void {
  if (!customElements.get(workspaceTasksPanelTagName)) {
    customElements.define(workspaceTasksPanelTagName, TasksPanelElement);
  }
}

export function tasksPanelBadge(context: WorkspacePanelContext): string | undefined {
  for (const source of taskSources) {
    const state = configCache.get(cacheKeyForSource(source, context));
    if (state?.kind === "unavailable") return "!";
  }
  return undefined;
}

class TasksPanelElement extends HTMLElement {
  private contextValue: WorkspacePanelContext | undefined;
  private runningKey: string | undefined;
  private status: TaskStatus | undefined;
  private readonly root: ShadowRoot;
  private readonly onConfigChanged = () => {
    this.render();
  };

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
  }

  set context(value: WorkspacePanelContext | undefined) {
    const previousKey = this.contextValue === undefined ? undefined : this.contextKey(this.contextValue);
    const nextKey = value === undefined ? undefined : this.contextKey(value);
    this.contextValue = value;
    // Parent app updates should not rebuild this shadow DOM for the same workspace:
    // doing so resets the mobile scroll position and can replace buttons mid-click.
    if (previousKey === nextKey) return;
    this.runningKey = undefined;
    this.status = undefined;
    this.render();
  }

  connectedCallback(): void {
    window.addEventListener(configChangedEvent, this.onConfigChanged);
    this.render();
  }

  disconnectedCallback(): void {
    window.removeEventListener(configChangedEvent, this.onConfigChanged);
  }

  private contextKey(context: WorkspacePanelContext): string {
    return taskSources.map((source) => cacheKeyForSource(source, context)).join("|");
  }

  private render(): void {
    const context = this.contextValue;
    if (context === undefined) {
      this.root.innerHTML = `${taskStyles()}<section class="empty">Select a workspace.</section>`;
      return;
    }

    const sections = taskSources
      .map((source) => ({ source, state: getOrLoadConfig(source, context) }))
      .map(({ source, state }) => this.renderSourceSection(source, state))
      .join("");

    this.root.innerHTML = `
      ${taskStyles()}
      <section class="toolbar">
        <strong>Scripts</strong>
        <span class="toolbar-tasks">
          <button class="secondary" data-refresh-config ${this.isAnyLoading(context) ? "disabled" : ""}>Refresh</button>
          <button class="secondary" data-open-terminal>Open Terminal</button>
        </span>
      </section>
      ${this.renderStatus()}
      <section class="viewer tasks-viewer">
        ${sections}
      </section>
    `;

    this.root.querySelector("button[data-refresh-config]")?.addEventListener("click", () => {
      void this.refreshAll(context);
    });

    for (const button of this.root.querySelectorAll<HTMLButtonElement>("button[data-task-id]")) {
      button.addEventListener("click", () => {
        const sourceId = button.getAttribute("data-source-id");
        const taskId = button.getAttribute("data-task-id");
        if (sourceId !== null && taskId !== null) void this.dispatchTaskById(context, sourceId, taskId);
      });
    }

    this.root.querySelector("button[data-open-terminal]")?.addEventListener("click", () => {
      this.openWorkspaceTerminal();
    });
  }

  private isAnyLoading(context: WorkspacePanelContext): boolean {
    return taskSources.some((source) => getCachedConfig(source, context)?.kind === "loading");
  }

  private renderSourceSection(source: TasksPanelSource, state: ConfigState): string {
    return `
      <section class="task-source">
        <h2>${escapeHtml(source.panelTitle)}</h2>
        <p class="muted source-path">${escapeHtml(source.configPathLabel)}</p>
        ${this.renderConfigState(source, state)}
      </section>
    `;
  }

  private renderConfigState(source: TasksPanelSource, state: ConfigState): string {
    if (state.kind === "loading") return `<p class="muted">Loading ${escapeHtml(source.configPathLabel)}…</p>`;
    if (state.kind === "missing") return renderMissingState(state);
    if (state.kind === "unavailable") return renderUnavailableState(state);

    if (state.config.tasks.length === 0) {
      return `<p class="muted">No scripts are defined in ${escapeHtml(state.path)}. Add scripts to the file, then click Refresh.</p>`;
    }
    return `
      <p class="muted">Scripts run in a dedicated workspace terminal, then switch to that terminal. Edit ${escapeHtml(state.path)} and click Refresh to reload.</p>
      ${renderTaskGroups(source, state.config.tasks, this.runningKey)}
    `;
  }

  private renderStatus(): string {
    if (this.status === undefined) return "";
    const detail = this.status.detail === undefined ? "" : `<pre>${escapeHtml(this.status.detail)}</pre>`;
    return `<div class="status panel-status ${escapeAttr(this.status.kind)}">${escapeHtml(this.status.message)}${detail}</div>`;
  }

  private async refreshAll(context: WorkspacePanelContext): Promise<void> {
    this.status = { kind: "info", message: "Refreshing script lists…" };
    for (const source of taskSources) {
      configCache.set(cacheKeyForSource(source, context), { kind: "loading" });
    }
    this.render();

    const results = await Promise.all(taskSources.map((source) => refreshConfig(source, context)));
    if (!this.isCurrentContext(context)) return;
    const loaded = results.filter((result): result is Extract<ConfigState, { kind: "loaded" }> => result.kind === "loaded");
    this.status = loaded.length > 0
      ? { kind: "success", message: `Loaded ${String(loaded.reduce((total, result) => total + result.config.tasks.length, 0))} script(s).` }
      : undefined;
    this.render();
  }

  private dispatchTaskById(context: WorkspacePanelContext, sourceId: string, taskId: string): Promise<void> {
    if (!this.isCurrentContext(context)) return Promise.resolve();
    const source = taskSources.find((candidate) => candidate.id === sourceId);
    if (source === undefined) return Promise.resolve();
    const task = taskFromConfigState(getCachedConfig(source, context), taskId);
    if (task === undefined) {
      this.status = { kind: "error", message: "That script is no longer available. Click Refresh, then try again." };
      this.render();
      return Promise.resolve();
    }
    return this.dispatchTask(context, source, task);
  }

  private isCurrentContext(context: WorkspacePanelContext): boolean {
    return this.contextValue !== undefined && this.contextKey(this.contextValue) === this.contextKey(context);
  }

  private async dispatchTask(context: WorkspacePanelContext, source: TasksPanelSource, task: WorkspaceTask): Promise<void> {
    const key = `${source.id}:${task.id}`;
    if (this.runningKey !== undefined) {
      this.status = { kind: "info", message: "Another script is already starting. Wait for it to finish dispatching, then try again." };
      this.render();
      return;
    }
    if (task.confirm && !window.confirm(`Run ${task.title}?\n\n${task.command}`)) {
      this.status = { kind: "info", message: `Cancelled ${task.title}.` };
      this.render();
      return;
    }

    this.runningKey = key;
    this.status = { kind: "info", message: `Starting ${task.title}…` };
    this.render();

    try {
      const handle = await runWorkspaceTaskInTerminal(context.terminal, task);
      if (!this.isCurrentContext(context)) return;
      this.status = {
        kind: "success",
        message: `Started terminal command “${handle.run.title}”.`,
        detail: task.command,
      };
      this.runningKey = undefined;
      this.render();
    } catch (error) {
      if (!this.isCurrentContext(context)) return;
      this.runningKey = undefined;
      this.status = { kind: "error", message: error instanceof Error ? error.message : String(error) };
      this.render();
    }
  }

  private openWorkspaceTerminal(terminalId?: string): void {
    const context = this.contextValue;
    if (context === undefined) {
      this.status = { kind: "error", message: "Select a workspace before opening a terminal." };
      this.render();
      return;
    }
    if (terminalId === undefined) context.terminal.open();
    else context.terminal.open({ terminalId });
  }
}

function getCachedConfig(source: TasksPanelSource, context: WorkspacePanelContext): ConfigState | undefined {
  return configCache.get(cacheKeyForSource(source, context));
}

function getOrLoadConfig(source: TasksPanelSource, context: WorkspacePanelContext): ConfigState {
  const cached = getCachedConfig(source, context);
  if (cached !== undefined) return cached;

  const loading: ConfigState = { kind: "loading" };
  configCache.set(cacheKeyForSource(source, context), loading);
  void refreshConfig(source, context);
  return loading;
}

async function refreshConfig(source: TasksPanelSource, context: WorkspacePanelContext): Promise<ConfigState> {
  const key = cacheKeyForSource(source, context);
  const state = await source.load(context).catch((error: unknown): ConfigState => ({
    kind: "unavailable",
    message: source.id === "global" ? globalTasksUnavailableMessage : tasksConfigUnavailableMessage,
    hint: source.id === "global" ? globalTasksRefreshHint : tasksConfigRefreshHint,
    detail: error instanceof Error ? error.message : String(error),
  }));
  configCache.set(key, state);
  context.host.requestRender();
  window.dispatchEvent(new Event(configChangedEvent));
  return state;
}

function cacheKeyForContext(context: WorkspacePanelContext): string {
  return `${context.machine.id}:${context.workspace.projectId}:${context.workspace.id}`;
}

function renderMissingState(state: Extract<ConfigState, { kind: "missing" }>): string {
  return `<div class="empty-state"><strong>${escapeHtml(state.message)}</strong><p>${escapeHtml(state.hint)}</p></div>`;
}

function renderUnavailableState(state: Extract<ConfigState, { kind: "unavailable" }>): string {
  const detail = state.detail === undefined ? "" : `<pre>${escapeHtml(state.detail)}</pre>`;
  return `<div class="status error"><strong>${escapeHtml(state.message)}</strong><p>${escapeHtml(state.hint)}</p>${detail}</div>`;
}

function renderTaskGroups(source: TasksPanelSource, tasks: WorkspaceTask[], runningKey: string | undefined): string {
  return `<div class="tasks">${groupTasks(tasks).map((group) => renderTaskGroup(source, group, runningKey)).join("")}</div>`;
}

function groupTasks(tasks: WorkspaceTask[]): { title: string | undefined; tasks: WorkspaceTask[] }[] {
  const groups: { title: string | undefined; tasks: WorkspaceTask[] }[] = [];
  for (const task of tasks) {
    const title = task.group;
    let group = groups.find((candidate) => candidate.title === title);
    if (group === undefined) {
      group = { title, tasks: [] };
      groups.push(group);
    }
    group.tasks.push(task);
  }
  return groups;
}

function renderTaskGroup(source: TasksPanelSource, group: { title: string | undefined; tasks: WorkspaceTask[] }, runningKey: string | undefined): string {
  const title = group.title === undefined ? "" : `<h3>${escapeHtml(group.title)}</h3>`;
  return `<section class="task-group">${title}${group.tasks.map((task) => renderTask(source, task, runningKey)).join("")}</section>`;
}

function renderTask(source: TasksPanelSource, task: WorkspaceTask, runningKey: string | undefined): string {
  const running = runningKey === `${source.id}:${task.id}`;
  const disabled = runningKey !== undefined;
  const description = task.description === undefined ? "" : `<span>${escapeHtml(task.description)}</span>`;
  return `
    <article class="task-card">
      <div class="task-copy">
        <strong>${escapeHtml(task.title)}</strong>
        ${description}
        <code>${escapeHtml(task.command)}</code>
      </div>
      <button data-source-id="${escapeAttr(source.id)}" data-task-id="${escapeAttr(task.id)}" ${disabled ? "disabled" : ""}>${running ? "Dispatching…" : "Run"}</button>
    </article>
  `;
}

function taskFromConfigState(state: ConfigState | undefined, taskId: string | null): WorkspaceTask | undefined {
  if (state?.kind !== "loaded" || taskId === null) return undefined;
  return state.config.tasks.find((task) => task.id === taskId);
}

function taskStyles(): string {
  return `
    <style>
      :host { display: contents; }
      .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--pi-border-muted); }
      .toolbar-tasks { display: inline-flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
      .viewer { box-sizing: border-box; min-height: 0; overflow: auto; padding: 12px; }
      .tasks-viewer { display: grid; align-content: start; gap: 16px; }
      .task-source { display: grid; gap: 8px; }
      .task-source h2 { margin: 0; font-size: 15px; }
      .task-source .source-path { margin: 0; font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .tasks { display: grid; gap: 14px; }
      .task-group { display: grid; gap: 10px; }
      .task-group h3 { margin: 4px 0 0; color: var(--pi-text-secondary); font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; }
      .task-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); padding: 12px; }
      .task-copy { display: grid; min-width: 0; gap: 5px; }
      .task-copy span, .muted { color: var(--pi-muted); }
      code, pre { border: 1px solid var(--pi-border-muted); border-radius: 6px; background: var(--pi-bg); color: var(--pi-text-secondary); font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      code { overflow: auto; padding: 5px 7px; white-space: nowrap; }
      pre { margin: 8px 0 0; overflow: auto; padding: 8px; white-space: pre-wrap; }
      button { border: 1px solid var(--pi-accent-border); border-radius: 7px; background: var(--pi-accent); color: var(--pi-bg); cursor: pointer; padding: 6px 10px; font: inherit; }
      button.secondary { border-color: var(--pi-border); background: var(--pi-surface); color: var(--pi-text); }
      button:disabled { cursor: wait; opacity: 0.65; }
      .empty-state { border: 1px dashed var(--pi-border-muted); border-radius: 8px; color: var(--pi-muted); padding: 12px; }
      .empty-state p { margin: 6px 0 0; }
      .panel-status { margin: 12px 12px 0; }
      .status { border: 1px solid var(--pi-border); border-radius: 8px; padding: 10px; }
      .status.info { border-color: var(--pi-accent-border); background: var(--pi-bg-overlay-soft); }
      .status.success { border-color: var(--pi-success-border); background: var(--pi-success-surface); color: var(--pi-success); }
      .status.error { border-color: var(--pi-danger); color: var(--pi-danger); }
      .empty { padding: 16px; color: var(--pi-muted); }
      @media (max-width: 760px) {
        .task-card { grid-template-columns: 1fr; }
        .task-card button { justify-self: start; }
      }
    </style>
  `;
}

function escapeHtml(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttr(value: unknown): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
