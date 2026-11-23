import { LEGACY_TASKS_CONFIG_PATH, SCRIPTS_CONFIG_PATH, parseTasksConfigText, type ConfigIssue, type WorkspaceTasksConfig } from "./config.js";

const missingWorkspaceFileError = "Path does not exist";

export interface WorkspaceTasksFileReader {
  readFile(path: string): Promise<WorkspaceTasksFileContent>;
  /** Optional: enables opportunistic migration of a legacy manifest to the canonical path. */
  writeFile?(path: string, content: string, options?: WorkspaceTasksWriteOptions): Promise<unknown>;
}

export interface WorkspaceTasksWriteOptions {
  createDirs?: boolean;
  overwrite?: boolean;
}

interface WorkspaceTasksFileContent {
  content: string;
  truncated: boolean;
  binary: boolean;
}

export type TasksLoadIssue =
  | { kind: "read"; path: string; error: string }
  | { kind: "unexpected"; error: string }
  | { kind: "binary" | "truncated"; path: string }
  | { kind: "config"; issue: ConfigIssue };

export type WorkspaceTasksConfigLoadResult =
  | { kind: "loaded"; config: WorkspaceTasksConfig; path: string }
  | { kind: "missing" }
  | { kind: "unavailable"; detail: TasksLoadIssue };

/**
 * Load the per-workspace scripts manifest. The canonical path is
 * {@link SCRIPTS_CONFIG_PATH}; the pre-rename {@link LEGACY_TASKS_CONFIG_PATH}
 * is still read, and a successful legacy read is opportunistically copied to
 * the canonical path so existing setups keep working without a manual rename.
 */
export async function loadWorkspaceTasksConfig(files: WorkspaceTasksFileReader): Promise<WorkspaceTasksConfigLoadResult> {
  const canonical = await readConfigFile(files, SCRIPTS_CONFIG_PATH);
  if (canonical.kind === "content") return parseLoaded(canonical.content, SCRIPTS_CONFIG_PATH);
  if (canonical.kind === "unavailable") return { kind: "unavailable", detail: canonical.detail };

  const legacy = await readConfigFile(files, LEGACY_TASKS_CONFIG_PATH);
  if (legacy.kind === "missing") return { kind: "missing" };
  if (legacy.kind === "unavailable") return { kind: "unavailable", detail: legacy.detail };

  const result = parseLoaded(legacy.content, SCRIPTS_CONFIG_PATH);
  if (result.kind === "loaded") await migrateLegacyConfig(files, legacy.content);
  return result;
}

type ReadOutcome =
  | { kind: "content"; content: string }
  | { kind: "missing" }
  | { kind: "unavailable"; detail: TasksLoadIssue };

function parseLoaded(content: string, path: string): WorkspaceTasksConfigLoadResult {
  const result = parseTasksConfigText(content);
  if (!result.ok) return { kind: "unavailable", detail: { kind: "config", issue: result.error } };
  return { kind: "loaded", config: result.config, path };
}

async function readConfigFile(files: WorkspaceTasksFileReader, path: string): Promise<ReadOutcome> {
  let file: WorkspaceTasksFileContent;
  try {
    file = await files.readFile(path);
  } catch (error) {
    if (error instanceof Error && error.message === missingWorkspaceFileError) return { kind: "missing" };
    return { kind: "unavailable", detail: { kind: "read", path, error: error instanceof Error ? error.message : String(error) } };
  }

  if (file.binary) return { kind: "unavailable", detail: { kind: "binary", path } };
  if (file.truncated) return { kind: "unavailable", detail: { kind: "truncated", path } };
  return { kind: "content", content: file.content };
}

async function migrateLegacyConfig(files: WorkspaceTasksFileReader, content: string): Promise<void> {
  if (files.writeFile === undefined) return;
  try {
    await files.writeFile(SCRIPTS_CONFIG_PATH, content, { overwrite: false });
  } catch {
    // Opportunistic migration must never turn a readable legacy config into an error.
  }
}
