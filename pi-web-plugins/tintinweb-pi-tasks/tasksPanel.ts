import type { TemplateResult } from "lit";
import type { HtmlTemplateTag, WorkspacePanelContext } from "@jmfederico/pi-web/plugin-api";
import { loadAgentTasks, statusIcon, taskCountLabel, type AgentTask } from "./agentTasksClient.js";

/**
 * Render cache keyed by workspace + selected session. `render` is synchronous
 * and shows whatever is cached; a cache miss starts an async load and asks the
 * host to re-render through `context.host.requestRender()`.
 */
interface TasksCacheEntry {
  tasks: AgentTask[];
  loading: boolean;
  error?: string | undefined;
}

const cache = new Map<string, TasksCacheEntry>();

function cacheKey(context: WorkspacePanelContext): string {
  const sessionId = context.state?.selectedSession?.id ?? "";
  return `${context.machine.id}:${context.workspace.projectId}:${context.workspace.id}:${sessionId}`;
}

function getEntry(context: WorkspacePanelContext): TasksCacheEntry {
  const key = cacheKey(context);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const entry: TasksCacheEntry = { tasks: [], loading: true };
  cache.set(key, entry);
  void refresh(context, entry);
  return entry;
}

async function refresh(context: WorkspacePanelContext, entry: TasksCacheEntry): Promise<void> {
  entry.loading = true;
  entry.error = undefined;
  try {
    entry.tasks = await loadAgentTasks(context.files, context.state?.selectedSession?.id);
  } catch (error) {
    entry.error = error instanceof Error ? error.message : String(error);
  } finally {
    entry.loading = false;
    context.host.requestRender();
  }
}

/** Re-read the active workspace's task files after a `workspace.files` invalidation. */
export function invalidateTasksPanel(context: WorkspacePanelContext): void {
  const entry = cache.get(cacheKey(context));
  if (entry !== undefined) void refresh(context, entry);
}

export function renderTasksPanel(html: HtmlTemplateTag, context: WorkspacePanelContext): TemplateResult {
  const entry = getEntry(context);
  const refreshButton = html`<button class="secondary" @click=${() => { void refresh(context, entry); }} ?disabled=${entry.loading}>Refresh</button>`;
  return html`
    <style>
      .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--pi-border-muted); }
      .viewer.tasks-viewer { box-sizing: border-box; min-height: 0; overflow: auto; padding: 12px; display: grid; align-content: start; gap: 10px; }
      .tasks-summary { color: var(--pi-muted); font-size: 12px; }
      .tasks-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
      .task { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 8px; align-items: start; }
      .task-icon { color: var(--pi-muted); text-align: center; line-height: 1.3; }
      .task-completed .task-icon { color: var(--pi-success); }
      .task-in_progress .task-icon { color: var(--pi-accent, var(--pi-text)); }
      .task-subject { color: var(--pi-text); overflow-wrap: anywhere; }
      .task-completed .task-subject { color: var(--pi-muted); text-decoration: line-through; }
      .task-desc { color: var(--pi-muted); font-size: 12px; overflow-wrap: anywhere; }
      .task-meta { color: var(--pi-muted); font-size: 11px; }
      .tasks-muted { color: var(--pi-muted); font-size: 13px; }
      .tasks-error { color: var(--pi-danger, var(--pi-muted)); }
      button { border: 1px solid var(--pi-accent-border); border-radius: 7px; background: var(--pi-accent); color: var(--pi-bg); cursor: pointer; padding: 6px 10px; font: inherit; }
      button.secondary { border-color: var(--pi-border); background: var(--pi-surface); color: var(--pi-text); }
      button:disabled { cursor: wait; opacity: 0.65; }
    </style>
    <section class="toolbar">
      <strong>Tasks</strong>
      ${refreshButton}
    </section>
    <section class="viewer tasks-viewer">
      ${renderBody(html, entry)}
    </section>
  `;
}

function renderBody(html: HtmlTemplateTag, entry: TasksCacheEntry): TemplateResult {
  if (entry.error !== undefined) return html`<div class="tasks-muted tasks-error">${entry.error}</div>`;
  if (entry.loading && entry.tasks.length === 0) return html`<div class="tasks-muted">Loading tasks…</div>`;
  if (entry.tasks.length === 0) {
    return html`<div class="tasks-muted">No tasks yet. Use the TaskCreate tool to add some.</div>`;
  }
  return html`
    <div class="tasks-summary">${taskCountLabel(entry.tasks)}</div>
    <ul class="tasks-list">
      ${entry.tasks.map((task) => renderTask(html, task))}
    </ul>
  `;
}

function renderTask(html: HtmlTemplateTag, task: AgentTask): TemplateResult {
  return html`
    <li class=${`task task-${task.status}`}>
      <span class="task-icon" aria-hidden="true">${statusIcon(task.status)}</span>
      <div class="task-body">
        <div class="task-subject">${task.subject}</div>
        ${task.description === undefined ? null : html`<div class="task-desc">${task.description}</div>`}
        ${task.blockedBy.length === 0 ? null : html`<div class="task-meta">blocked by #${task.blockedBy.join(", #")}</div>`}
      </div>
    </li>
  `;
}
