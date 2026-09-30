import { mkdir as mkdirFs, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type {
  PiWebServerPlugin,
  ProjectInput,
  ProviderClaim,
  ProviderCreateContext,
  ProviderRemoveContext,
  ProviderWorkspace,
  ServerPluginActivationContext,
  ServerPluginExecFileResult,
  WorkspaceProvider,
  WorkspaceRemovePlan,
} from "@jmfederico/pi-web/server-plugin-api";

/**
 * `jj workspace list` template fields, separated by tabs and terminated by a
 * newline. Jujutsu quotes a workspace name in Rust debug form when it contains
 * anything unusual (spaces, tabs, quotes); the root is always emitted raw, so
 * the variable-length root is placed last and read as the line remainder.
 */
export const JJ_LIST_TEMPLATE = 'name ++ "\\t" ++ self.target().change_id().short() ++ "\\t" ++ root ++ "\\n"';

const JJ_REVISION_TEMPLATE = 'commit_id.short() ++ "\\n"';

export interface JjWorkspaceRecord {
  name: string;
  changeId: string;
  root: string;
}

/** Injectable directory probe so provider behavior stays testable without a filesystem. */
export type JjWorkspacePathInspector = (path: string) => Promise<boolean>;

export interface JjWorkspaceProviderOptions {
  isDirectory?: JjWorkspacePathInspector;
}

const plugin: PiWebServerPlugin = {
  apiVersion: 3,
  name: "Jujutsu",
  activate(context) {
    return {
      workspaceProvider: createJjWorkspaceProvider(context),
    };
  },
};

export default plugin;

/**
 * Jujutsu workspaces are the unit of parallel work in a `jj` repository, so the
 * provider claims any project inside a Jujutsu workspace and replaces the
 * bundled Git provider there. It is a primary (non-fallback) provider, which is
 * what lets it win over Git for a colocated repository, and it is inert when the
 * `jj` executable is not installed.
 */
export function createJjWorkspaceProvider(
  context: ServerPluginActivationContext,
  options: JjWorkspaceProviderOptions = {},
): WorkspaceProvider {
  const isDirectory = options.isDirectory ?? realIsDirectory;

  async function resolveWorkspaceRoot(cwd: string, signal: AbortSignal): Promise<string> {
    const result = await requireJj(
      runJj(context, cwd, ["--ignore-working-copy", "root"], signal),
      "resolve the Jujutsu workspace root",
    );
    const root = result.stdout.trim();
    if (root === "") throw new Error("jj returned an empty workspace root");
    return resolve(root);
  }

  async function listRecords(cwd: string, signal: AbortSignal): Promise<JjWorkspaceRecord[]> {
    const result = await requireJj(
      runJj(context, cwd, ["--ignore-working-copy", "workspace", "list", "-T", JJ_LIST_TEMPLATE], signal),
      "list Jujutsu workspaces",
    );
    return parseJjWorkspaceList(result.stdout);
  }

  return Object.freeze({
    async probe(project: ProjectInput, signal: AbortSignal): Promise<ProviderClaim> {
      let result: ServerPluginExecFileResult;
      try {
        result = await runJj(context, project.path, ["--ignore-working-copy", "root"], signal);
      } catch (error) {
        // A machine without Jujutsu keeps the bundled Git fallback unchanged.
        if (isMissingExecutable(error)) return "pass";
        throw error;
      }
      if (result.signal !== null) throw new Error(`jj root ended from signal ${result.signal}`);
      return result.exitCode === 0 ? "claim" : "pass";
    },
    async list(project: ProjectInput, signal: AbortSignal): Promise<ProviderWorkspace[]> {
      const projectRoot = await resolveWorkspaceRoot(project.path, signal);
      const records = await listRecords(project.path, signal);

      const entries: JjWorkspaceRecord[] = [];
      for (const record of records) {
        if (record.root === "") continue;
        const root = resolve(record.root);
        if (!(await isDirectory(root))) continue;
        entries.push({ ...record, root });
      }
      // A workspace directory deleted outside Jujutsu still appears in the
      // listing with an empty root, and the registered project workspace can be
      // absent if its own directory was removed. Keep the project usable by
      // synthesizing the main entry the way the host expects: exactly one.
      if (!entries.some(({ root }) => root === projectRoot) && await isDirectory(projectRoot)) {
        entries.push({ name: basename(projectRoot) || projectRoot, changeId: "", root: projectRoot });
      }
      if (entries.length === 0) return [singleJjWorkspace(project)];

      return entries.map((record) => jjProviderWorkspace(record, record.root === projectRoot));
    },
    async createWorkspace({ project, worktreeParentDir, input, signal }: ProviderCreateContext): Promise<ProviderWorkspace> {
      const name = input.name;
      const workspaceName = input.branchName === undefined || input.branchName === "" ? name : input.branchName;
      const destination = resolve(worktreeParentDir, name);

      // Validate the revset first: `jj workspace add --revision` registers the
      // new workspace before it reports an unresolvable revision, which would
      // otherwise strand a half-created workspace.
      if (input.baseRef !== undefined) {
        await requireJj(
          runJj(context, project.path, ["--ignore-working-copy", "log", "-r", input.baseRef, "--no-graph", "-T", JJ_REVISION_TEMPLATE], signal),
          `resolve revision ${input.baseRef}`,
        );
      }

      await mkdirFs(worktreeParentDir, { recursive: true });
      const args = ["workspace", "add", "--name", workspaceName];
      if (input.baseRef !== undefined) args.push("--revision", input.baseRef);
      args.push(destination);
      const result = await runJj(context, project.path, args, signal);
      if (result.signal !== null) throw new Error(`jj workspace add ended from signal ${result.signal}`);
      if (result.exitCode !== 0) {
        const detail = result.stderr.trim() || result.stdout.trim();
        throw new Error(
          `Unable to create Jujutsu workspace ${workspaceName} (exit ${String(result.exitCode)})${detail === "" ? "" : `: ${detail}`}`,
        );
      }
      return {
        key: destination,
        path: destination,
        label: workspaceName,
        isMain: false,
        data: { workspaceName, root: destination },
        publicMetadata: {
          isJjRepo: true,
          isJjWorkspace: true,
          workspace: workspaceName,
        },
      };
    },
    async prepareRemove({ project, workspace, signal }: ProviderRemoveContext): Promise<WorkspaceRemovePlan> {
      const data = jjRemovalData(workspace);
      if (resolve(data.root) !== workspace.path) {
        throw new Error("Jujutsu workspace removal data no longer matches the current workspace path");
      }
      const projectRoot = await resolveWorkspaceRoot(project.path, signal);
      if (workspace.path === projectRoot) throw new Error("A main Jujutsu workspace cannot be removed");
      const records = await listRecords(project.path, signal);
      const current = records.find((record) => record.root !== "" && resolve(record.root) === workspace.path);
      if (current === undefined) throw new Error("Jujutsu workspace is no longer available for removal");
      if (current.name !== data.workspaceName) {
        throw new Error("Jujutsu workspace name changed since it was listed");
      }
      return {
        title: `Delete workspace: ${workspace.label}`,
        command: `jj workspace forget ${shellQuote(current.name)} && rm -rf ${shellQuote(workspace.path)}`,
      };
    },
  });
}

/**
 * Parse the tab-delimited `jj workspace list -T` output. The name field is
 * Jujutsu's debug rendering of the workspace name and may be quoted; the root is
 * raw and occupies the remainder of the line so paths with tabs survive.
 */
export function parseJjWorkspaceList(stdout: string): JjWorkspaceRecord[] {
  const records: JjWorkspaceRecord[] = [];
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") continue;
    const firstTab = line.indexOf("\t");
    const secondTab = firstTab === -1 ? -1 : line.indexOf("\t", firstTab + 1);
    if (firstTab === -1 || secondTab === -1) throw new Error(`Unexpected jj workspace list line: ${line}`);
    records.push({
      name: unquoteJjTemplateString(line.slice(0, firstTab)),
      changeId: line.slice(firstTab + 1, secondTab),
      root: line.slice(secondTab + 1),
    });
  }
  return records;
}

function unquoteJjTemplateString(value: string): string {
  if (!value.startsWith("\"")) return value;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "string") return parsed;
  } catch {
    return value;
  }
  return value;
}

function jjProviderWorkspace(record: JjWorkspaceRecord, isMain: boolean): ProviderWorkspace {
  return {
    key: record.root,
    path: record.root,
    label: record.name,
    isMain,
    data: { workspaceName: record.name, root: record.root },
    publicMetadata: {
      isJjRepo: true,
      isJjWorkspace: true,
      workspace: record.name,
      ...(record.changeId === "" ? {} : { changeId: record.changeId }),
    },
    ...(isMain ? {} : { removal: jjRemovalPresentation(record.name, record.root) }),
  };
}

function singleJjWorkspace(project: ProjectInput): ProviderWorkspace {
  return {
    key: project.path,
    path: project.path,
    label: project.name,
    isMain: true,
    data: { workspaceName: basename(project.path) || project.path, root: project.path },
    publicMetadata: { isJjRepo: true, isJjWorkspace: false },
  };
}

function jjRemovalPresentation(name: string, path: string): NonNullable<ProviderWorkspace["removal"]> {
  return {
    actionLabel: "Delete workspace",
    confirmation: `Delete workspace ${name}?\n\nThis will run jj workspace forget and delete:\n${path}\n\nCommitted changes remain in the Jujutsu repository.`,
  };
}

function jjRemovalData(workspace: ProviderWorkspace): { workspaceName: string; root: string } {
  const data = workspace.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Jujutsu workspace removal data is unavailable");
  }
  const workspaceName: unknown = Reflect.get(data, "workspaceName");
  const root: unknown = Reflect.get(data, "root");
  if (typeof workspaceName !== "string" || workspaceName === "") {
    throw new Error("Jujutsu workspace name is unavailable for removal");
  }
  if (typeof root !== "string" || root === "") throw new Error("Jujutsu workspace root is unavailable for removal");
  return { workspaceName, root };
}

async function realIsDirectory(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isDirectory();
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
}

function isMissingExecutable(error: unknown): boolean {
  const code = errorCode(error);
  return code === "ENOENT" || code === "EACCES" || code === "EPERM";
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code: unknown = Reflect.get(error, "code");
  return typeof code === "string" ? code : undefined;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function runJj(
  context: ServerPluginActivationContext,
  cwd: string,
  args: readonly string[],
  signal: AbortSignal,
): Promise<ServerPluginExecFileResult> {
  const result = await context.execFile({ file: "jj", args, cwd, signal });
  if (result.stdoutTruncated || result.stderrTruncated) {
    throw new Error(`jj ${args.join(" ")} exceeded the host output limit`);
  }
  return result;
}

async function requireJj(
  resultPromise: Promise<ServerPluginExecFileResult>,
  action: string,
): Promise<ServerPluginExecFileResult> {
  const result = await resultPromise;
  if (result.signal === null && result.exitCode === 0) return result;
  const detail = result.stderr.trim();
  const outcome = result.signal === null ? `exit ${String(result.exitCode)}` : `signal ${result.signal}`;
  throw new Error(`Unable to ${action} (${outcome})${detail === "" ? "" : `: ${detail}`}`);
}