/**
 * Reads the Pi agent's task list (the `TaskCreate`/`TaskUpdate` tools) for the
 * selected workspace. Tasks are stored under `<workspace>/.pi/tasks/`:
 *   - `tasks-<sessionId>.json` per session (the default scope)
 *   - `tasks.json`            project-shared scope
 * The panel aggregates those files and deduplicates by task id, preferring the
 * active session's copy. Every read degrades to an empty list rather than
 * throwing, so an unavailable workspace never blanks the whole panel.
 *
 * Everything goes through the public `files` capability, so this works locally
 * and through machine federation without a server entry.
 */

/** Directory holding the Pi agent task files, relative to the workspace root. */
export const AGENT_TASKS_DIR = ".pi/tasks";
/** Project-shared task file, read in addition to the per-session files. */
export const PROJECT_TASKS_FILENAME = "tasks.json";

export interface AgentTask {
  id: string;
  subject: string;
  description?: string;
  status: string;
  blockedBy: string[];
}

export interface AgentTaskFileReader {
  readFile(path: string): Promise<{ content: string; binary: boolean; truncated: boolean }>;
  listFiles(path: string): Promise<{ entries: readonly { name: string; path: string; type: string }[] }>;
}

/** Parse one task file, accepting both the object envelope and a bare array. */
export function parseAgentTasks(content: string): AgentTask[] {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return [];
  }

  const list = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data["tasks"])
      ? data["tasks"]
      : [];
  return list.flatMap((value) => {
    const task = toAgentTask(value);
    return task === undefined ? [] : [task];
  });
}

function toAgentTask(value: unknown): AgentTask | undefined {
  if (!isRecord(value) || typeof value["id"] !== "string") return undefined;
  const description = value["description"];
  const subject = value["subject"];
  const status = value["status"];
  const blockedBy = value["blockedBy"];
  return {
    id: value["id"],
    subject: typeof subject === "string" ? subject : "",
    status: typeof status === "string" ? status : "pending",
    blockedBy: Array.isArray(blockedBy) ? blockedBy.filter((id): id is string => typeof id === "string") : [],
    ...(typeof description === "string" && description !== "" ? { description } : {}),
  };
}

/** List per-session task files in the workspace; unreadable directories yield none. */
export async function listSessionTaskFiles(files: AgentTaskFileReader): Promise<string[]> {
  let tree: Awaited<ReturnType<AgentTaskFileReader["listFiles"]>>;
  try {
    tree = await files.listFiles(AGENT_TASKS_DIR);
  } catch {
    return [];
  }
  return tree.entries
    .filter((entry) => entry.type !== "directory" && /^tasks-.+\.json$/u.test(entry.name))
    .map((entry) => entry.path);
}

/**
 * Aggregate the active session's tasks, the other session files (when no session
 * is selected), and the project-shared list. The active session wins on dedup.
 */
export async function loadAgentTasks(files: AgentTaskFileReader, sessionId: string | undefined): Promise<AgentTask[]> {
  const tasks: AgentTask[] = [];
  const seen = new Set<string>();
  const add = (list: readonly AgentTask[]): void => {
    for (const task of list) {
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      tasks.push(task);
    }
  };

  if (sessionId !== undefined && sessionId !== "") {
    add(await readTaskFile(files, `${AGENT_TASKS_DIR}/tasks-${sessionId}.json`));
  } else {
    for (const path of await listSessionTaskFiles(files)) add(await readTaskFile(files, path));
  }
  add(await readTaskFile(files, `${AGENT_TASKS_DIR}/${PROJECT_TASKS_FILENAME}`));

  return tasks.sort((left, right) => numericId(left.id) - numericId(right.id));
}

async function readTaskFile(files: AgentTaskFileReader, path: string): Promise<AgentTask[]> {
  try {
    const file = await files.readFile(path);
    if (file.binary || file.truncated) return [];
    return parseAgentTasks(file.content);
  } catch {
    return [];
  }
}

function numericId(id: string): number {
  const parsed = Number(id);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function statusIcon(status: string): string {
  if (status === "completed") return "\u2714";
  if (status === "in_progress") return "\u25A0";
  return "\u25A1";
}

/** Compact "N done · M active · K open" summary; "no tasks" when empty. */
export function taskCountLabel(tasks: readonly AgentTask[]): string {
  const done = tasks.filter((task) => task.status === "completed").length;
  const active = tasks.filter((task) => task.status === "in_progress").length;
  const open = tasks.length - done - active;
  const parts: string[] = [];
  if (done > 0) parts.push(`${String(done)} done`);
  if (active > 0) parts.push(`${String(active)} active`);
  if (open > 0) parts.push(`${String(open)} open`);
  return parts.length === 0 ? "no tasks" : parts.join(" \u00b7 ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
