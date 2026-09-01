import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseTasksConfigText, type WorkspaceTasksConfig } from "../shared/tasksConfig.js";

/**
 * Canonical filename of the machine-wide scripts manifest inside the pi-web data
 * dir (`<dataDir>/scripts.json`). This is distinct from the per-workspace
 * `.pi-web/scripts.json` read by the Scripts panel: global scripts are available
 * in every workspace and live outside any workspace root, so a browser plugin
 * cannot reach them through the workspace-scoped `files` API.
 */
export const GLOBAL_SCRIPTS_CONFIG_FILENAME = "scripts.json";

/** Pre-rename manifest, still read and opportunistically migrated to the canonical path. */
export const LEGACY_GLOBAL_TASKS_CONFIG_FILENAME = "tasks.json";

export const globalTasksMissingMessage = "No global scripts configured.";
export const globalTasksMissingHint = "Create ~/.pi-web/scripts.json to define scripts available in every workspace (legacy ~/.pi-web/tasks.json is still read).";
export const globalTasksUnavailableMessage = "Could not load global scripts.";
export const globalTasksRefreshHint = "Fix ~/.pi-web/scripts.json, then click Refresh.";

export type GlobalTasksConfigResult =
  | { kind: "loaded"; config: WorkspaceTasksConfig; path: string }
  | { kind: "missing"; message: string; hint: string }
  | { kind: "unavailable"; message: string; hint: string; detail?: string };

type ReadOutcome =
  | { kind: "content"; content: string }
  | { kind: "missing" }
  | { kind: "unavailable"; detail: string };

/**
 * Read and validate the data-dir global scripts manifest. The data dir is
 * resolved by the caller (usually `piWebDataDir(env)`), so this stays a pure
 * filesystem read with no host-environment coupling and is easy to unit test.
 * The canonical `scripts.json` wins; a legacy `tasks.json` is read and copied
 * to the canonical path opportunistically.
 */
export async function loadGlobalTasksConfig(dataDir: string): Promise<GlobalTasksConfigResult> {
  const canonicalPath = join(dataDir, GLOBAL_SCRIPTS_CONFIG_FILENAME);
  const canonical = await readConfigFile(canonicalPath);
  if (canonical.kind === "content") return parseLoaded(canonical.content, canonicalPath);
  if (canonical.kind === "unavailable") return unavailable(canonical.detail);

  const legacyPath = join(dataDir, LEGACY_GLOBAL_TASKS_CONFIG_FILENAME);
  const legacy = await readConfigFile(legacyPath);
  if (legacy.kind === "missing") return missing();
  if (legacy.kind === "unavailable") return unavailable(legacy.detail);

  const result = parseLoaded(legacy.content, canonicalPath);
  if (result.kind === "loaded") await migrateLegacyConfig(canonicalPath, legacy.content);
  return result;
}

function parseLoaded(content: string, path: string): GlobalTasksConfigResult {
  const parsed = parseTasksConfigText(content);
  if (!parsed.ok) return unavailable(parsed.error);
  return { kind: "loaded", config: parsed.config, path };
}

async function readConfigFile(path: string): Promise<ReadOutcome> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeNotFound(error)) return { kind: "missing" };
    return { kind: "unavailable", detail: errorMessage(error) };
  }
  return { kind: "content", content };
}

async function migrateLegacyConfig(canonicalPath: string, content: string): Promise<void> {
  try {
    // "wx" refuses to clobber a canonical file that appeared between the read and this write.
    await writeFile(canonicalPath, content, { encoding: "utf8", flag: "wx" });
  } catch {
    // Opportunistic migration must never turn a readable legacy config into an error.
  }
}

function missing(): GlobalTasksConfigResult {
  return { kind: "missing", message: globalTasksMissingMessage, hint: globalTasksMissingHint };
}

function unavailable(detail: string): GlobalTasksConfigResult {
  return {
    kind: "unavailable",
    message: globalTasksUnavailableMessage,
    hint: globalTasksRefreshHint,
    detail,
  };
}

function isNodeNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
