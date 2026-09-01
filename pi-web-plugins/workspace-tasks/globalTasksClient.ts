import type { WorkspaceTasksConfigLoadResult } from "./workspaceTasksClient.js";

/** Same-origin route served by the session daemon (see globalTasksRoutes.ts). */
export const globalTasksRoutePath = "api/global-tasks/config";

export const globalTasksConfigPathLabel = "<data-dir>/tasks.json";
export const globalTasksMissingMessage = "No global tasks configured.";
export const globalTasksMissingHint = "Create ~/.pi-web/tasks.json to define tasks available in every workspace.";
export const globalTasksUnavailableMessage = "Could not load global tasks.";
export const globalTasksRefreshHint = "Fix ~/.pi-web/tasks.json, then click Refresh.";

export type GlobalTasksConfigLoadResult = WorkspaceTasksConfigLoadResult;

/**
 * Resolve the global-tasks config route against the running application base.
 * The plugin module is served from `<appBase>/pi-web-plugins/workspace-tasks/`,
 * so walking up three segments lands on `<appBase>` regardless of whether the
 * app is deployed at the origin root or a nested path. This mirrors how the
 * client builds plugin-backend URLs and keeps the request same-origin (so it
 * rides the existing session cookie auth).
 */
function globalTasksConfigUrl(): string {
  const base = new URL("../../..", import.meta.url);
  return new URL(globalTasksRoutePath, base).toString();
}

/**
 * Load the machine-wide task manifest. Global tasks live in the data dir, which
 * a browser plugin cannot read through the workspace-scoped `files` API, so the
 * panel fetches them from the dedicated session-daemon route instead of reading
 * the file directly. Network and parse failures degrade to `unavailable` rather
 * than throwing, matching the Workspace Tasks panel's resilience contract.
 */
export async function loadGlobalTasksConfig(): Promise<GlobalTasksConfigLoadResult> {
  let response: Response;
  try {
    response = await fetch(globalTasksConfigUrl(), { headers: { accept: "application/json" } });
  } catch (error) {
    return {
      kind: "unavailable",
      message: globalTasksUnavailableMessage,
      hint: globalTasksRefreshHint,
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  if (!response.ok) {
    return {
      kind: "unavailable",
      message: globalTasksUnavailableMessage,
      hint: globalTasksRefreshHint,
      detail: `HTTP ${String(response.status)}`,
    };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    return {
      kind: "unavailable",
      message: globalTasksUnavailableMessage,
      hint: globalTasksRefreshHint,
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  if (!isLoadResult(data)) {
    return {
      kind: "unavailable",
      message: globalTasksUnavailableMessage,
      hint: globalTasksRefreshHint,
      detail: "Unexpected global tasks response shape",
    };
  }
  return data;
}

function isLoadResult(value: unknown): value is GlobalTasksConfigLoadResult {
  if (!isRecord(value)) return false;
  const kind = value["kind"];
  if (kind === "loaded" || kind === "missing" || kind === "unavailable") return true;
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
