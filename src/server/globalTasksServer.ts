import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseTasksConfigText, type WorkspaceTasksConfig } from "../shared/tasksConfig.js";

/**
 * Filename of the machine-wide task manifest inside the pi-web data dir
 * (`<dataDir>/tasks.json`). This is distinct from the per-workspace
 * `.pi-web/tasks.json` read by the Workspace Tasks panel: global tasks are
 * available in every workspace and live outside any workspace root, so a
 * browser plugin cannot reach them through the workspace-scoped `files` API.
 */
export const GLOBAL_TASKS_CONFIG_FILENAME = "tasks.json";

export const globalTasksMissingMessage = "No global tasks configured.";
export const globalTasksMissingHint = "Create ~/.pi-web/tasks.json to define tasks available in every workspace.";
export const globalTasksUnavailableMessage = "Could not load global tasks.";
export const globalTasksRefreshHint = "Fix ~/.pi-web/tasks.json, then click Refresh.";

export type GlobalTasksConfigResult =
  | { kind: "loaded"; config: WorkspaceTasksConfig; path: string }
  | { kind: "missing"; message: string; hint: string }
  | { kind: "unavailable"; message: string; hint: string; detail?: string };

/**
 * Read and validate the data-dir global tasks manifest. The data dir is
 * resolved by the caller (usually `piWebDataDir(env)`), so this stays a pure
 * filesystem read with no host-environment coupling and is easy to unit test.
 */
export async function loadGlobalTasksConfig(dataDir: string): Promise<GlobalTasksConfigResult> {
  const path = join(dataDir, GLOBAL_TASKS_CONFIG_FILENAME);
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeNotFound(error)) {
      return { kind: "missing", message: globalTasksMissingMessage, hint: globalTasksMissingHint };
    }
    return {
      kind: "unavailable",
      message: globalTasksUnavailableMessage,
      hint: globalTasksRefreshHint,
      detail: errorMessage(error),
    };
  }

  const parsed = parseTasksConfigText(content);
  if (!parsed.ok) {
    return {
      kind: "unavailable",
      message: globalTasksUnavailableMessage,
      hint: globalTasksRefreshHint,
      detail: parsed.error,
    };
  }

  return { kind: "loaded", config: parsed.config, path };
}

function isNodeNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
