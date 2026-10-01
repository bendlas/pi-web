import { parseTasksConfigText, type WorkspaceTasksConfig } from "./config.js";

/** Canonical per-workspace scripts manifest. */
export const SCRIPTS_CONFIG_PATH = ".pi-web/scripts.json";
/** Legacy per-workspace tasks manifest, still read so existing setups keep working. */
export const LEGACY_TASKS_CONFIG_PATH = ".pi-web/tasks.json";

export const tasksConfigMissingMessage = "No workspace scripts configured here.";
export const tasksConfigMissingHint = `${SCRIPTS_CONFIG_PATH} is optional. Create it in this workspace if you want custom scripts.`;
export const tasksConfigUnavailableMessage = "Could not load workspace scripts.";
export const tasksConfigRefreshHint = `Fix ${SCRIPTS_CONFIG_PATH}, then click Refresh.`;

const missingWorkspaceFileError = "Path does not exist";

export interface WorkspaceTasksFileReader {
  readFile(path: string): Promise<WorkspaceTasksFileContent>;
  /** Optional: enables opportunistic migration of a legacy config to the canonical path. */
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

export type WorkspaceTasksConfigLoadResult =
  | { kind: "loaded"; config: WorkspaceTasksConfig; path: string }
  | { kind: "missing"; message: string; hint: string }
  | { kind: "unavailable"; message: string; hint: string; detail?: string };

type ReadOutcome =
  | { kind: "content"; content: string }
  | { kind: "missing" }
  | { kind: "unavailable"; detail: string };

/**
 * Load the per-workspace scripts manifest. The canonical path is
 * {@link SCRIPTS_CONFIG_PATH}; the pre-rename {@link LEGACY_TASKS_CONFIG_PATH}
 * is still read, and a successful legacy read is opportunistically copied to
 * the canonical path so new setups converge without a manual rename.
 */
export async function loadWorkspaceTasksConfig(files: WorkspaceTasksFileReader): Promise<WorkspaceTasksConfigLoadResult> {
  const canonical = await readConfigFile(files, SCRIPTS_CONFIG_PATH);
  if (canonical.kind === "content") return parseLoaded(canonical.content, SCRIPTS_CONFIG_PATH);
  if (canonical.kind === "unavailable") return unavailable(canonical.detail);

  const legacy = await readConfigFile(files, LEGACY_TASKS_CONFIG_PATH);
  if (legacy.kind === "missing") return missing();
  if (legacy.kind === "unavailable") return unavailable(legacy.detail);

  const result = parseLoaded(legacy.content, SCRIPTS_CONFIG_PATH);
  if (result.kind === "loaded") await migrateLegacyConfig(files, legacy.content);
  return result;
}

function parseLoaded(content: string, path: string): WorkspaceTasksConfigLoadResult {
  const result = parseTasksConfigText(content);
  if (!result.ok) return unavailable(result.error);
  return { kind: "loaded", config: result.config, path };
}

async function readConfigFile(files: WorkspaceTasksFileReader, path: string): Promise<ReadOutcome> {
  let file: WorkspaceTasksFileContent;
  try {
    file = await files.readFile(path);
  } catch (error) {
    if (errorMessage(error) === missingWorkspaceFileError) return { kind: "missing" };
    return { kind: "unavailable", detail: `Unable to read ${path}: ${formatUnknownError(error)}` };
  }

  if (file.binary) return { kind: "unavailable", detail: `${path} must be a text file` };
  if (file.truncated) return { kind: "unavailable", detail: `${path} is too large and was truncated` };
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

function missing(): WorkspaceTasksConfigLoadResult {
  return {
    kind: "missing",
    message: tasksConfigMissingMessage,
    hint: tasksConfigMissingHint,
  };
}

function unavailable(detail: string): WorkspaceTasksConfigLoadResult {
  return {
    kind: "unavailable",
    message: tasksConfigUnavailableMessage,
    hint: tasksConfigRefreshHint,
    detail,
  };
}

function errorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
