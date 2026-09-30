import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ProjectInput,
  ServerPluginActivation,
  ServerPluginActivationContext,
  ServerPluginExecFileResult,
  WorkspaceProvider,
} from "@jmfederico/pi-web/server-plugin-api";
import type { Project } from "../../src/shared/apiTypes.js";
import { createServerPluginExecFile } from "../../src/server/plugins/serverPluginExec.js";
import type { ServerPluginProviderContribution } from "../../src/server/plugins/serverPluginRuntime.js";
import { WorkspaceProviderRegistry } from "../../src/server/workspaces/workspaceProviderRegistry.js";
import plugin, {
  createJjWorkspaceProvider,
  JJ_LIST_TEMPLATE,
  parseJjWorkspaceList,
  type JjWorkspaceProviderOptions,
} from "./server-plugin.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("bundled Jujutsu workspace provider", () => {
  it("activates a primary provider and stays inert when jj is unavailable", async () => {
    const activation: ServerPluginActivation = await plugin.activate(contextFor(missingExecutable()));
    const provider = requiredProvider(activation);
    expect(provider.fallback).not.toBe(true);

    await expect(provider.probe(project("/repo"), new AbortController().signal)).resolves.toBe("pass");
  });

  it("claims inside a Jujutsu workspace and passes elsewhere", async () => {
    const claimed = providerFor(vi.fn<ExecFile>(() => Promise.resolve(commandResult({ stdout: "/repo\n" }))));
    expect(claimed.fallback).not.toBe(true);
    await expect(claimed.probe(project("/repo"), new AbortController().signal)).resolves.toBe("claim");

    const outside = providerFor(vi.fn<ExecFile>(() => Promise.resolve(commandResult({ exitCode: 1, stderr: "There is no jj repo\n" }))));
    await expect(outside.probe(project("/plain"), new AbortController().signal)).resolves.toBe("pass");
  });

  it("lists workspaces, drops vanished directories, and marks only the project workspace main", async () => {
    const execFile = vi.fn<ExecFile>((request) => {
      const args = request.args ?? [];
      if (args.includes("workspace")) {
        return Promise.resolve(commandResult({
          stdout: [
            "default\tznvutqtz\t/repo",
            "\"feature one\"\tkmnopqrs\t/linked",
            "gone\tqwertyui\t",
          ].join("\n") + "\n",
        }));
      }
      return Promise.resolve(commandResult({ stdout: "/repo\n" }));
    });
    const existing = new Set(["/repo", "/linked"]);
    const provider = providerFor(execFile, { isDirectory: (path) => Promise.resolve(existing.has(path)) });

    const workspaces = await provider.list(project("/repo"), new AbortController().signal);

    expect(workspaces).toEqual([
      expect.objectContaining({
        key: "/repo",
        path: "/repo",
        label: "default",
        isMain: true,
        publicMetadata: { isJjRepo: true, isJjWorkspace: true, workspace: "default", changeId: "znvutqtz" },
      }),
      expect.objectContaining({
        key: "/linked",
        path: "/linked",
        label: "feature one",
        isMain: false,
        publicMetadata: { isJjRepo: true, isJjWorkspace: true, workspace: "feature one", changeId: "kmnopqrs" },
        removal: {
          actionLabel: "Delete workspace",
          confirmation: "Delete workspace feature one?\n\nThis will run jj workspace forget and delete:\n/linked\n\nCommitted changes remain in the Jujutsu repository.",
        },
      }),
    ]);
    expect(workspaces.map(({ path }) => path)).not.toContain("gone");
    expect(workspaces.find(({ isMain }) => isMain)).not.toHaveProperty("removal");
    expect(execFile).toHaveBeenCalledWith(expect.objectContaining({
      file: "jj",
      args: ["--ignore-working-copy", "workspace", "list", "-T", JJ_LIST_TEMPLATE],
    }));
  });

  it("treats a registered subdirectory as the main workspace of its Jujutsu workspace", async () => {
    const execFile = vi.fn<ExecFile>((request) => {
      const args = request.args ?? [];
      if (args.includes("workspace")) {
        return Promise.resolve(commandResult({ stdout: "default\tznvutqtz\t/repo\nother\tkmnopqrs\t/linked\n" }));
      }
      return Promise.resolve(commandResult({ stdout: "/repo\n" }));
    });
    const existing = new Set(["/repo", "/linked"]);
    const provider = providerFor(execFile, { isDirectory: (path) => Promise.resolve(existing.has(path)) });

    const workspaces = await provider.list(project("/repo/packages/app"), new AbortController().signal);

    expect(workspaces.map(({ path, isMain }) => ({ path, isMain }))).toEqual([
      { path: "/repo", isMain: true },
      { path: "/linked", isMain: false },
    ]);
  });

  it("synthesizes the main workspace and falls back to the project folder when nothing is listable", async () => {
    const execFile = vi.fn<ExecFile>((request) => {
      const args = request.args ?? [];
      if (args.includes("workspace")) return Promise.resolve(commandResult({ stdout: "default\tznvutqtz\t\n" }));
      return Promise.resolve(commandResult({ stdout: "/repo\n" }));
    });
    const provider = providerFor(execFile, { isDirectory: (path) => Promise.resolve(path === "/repo") });

    await expect(provider.list(project("/repo"), new AbortController().signal)).resolves.toEqual([
      expect.objectContaining({
        path: "/repo",
        label: "repo",
        isMain: true,
        publicMetadata: { isJjRepo: true, isJjWorkspace: true, workspace: "repo" },
      }),
    ]);

    const emptyProvider = providerFor(execFile, { isDirectory: () => Promise.resolve(false) });
    await expect(emptyProvider.list(project("/repo"), new AbortController().signal)).resolves.toEqual([
      expect.objectContaining({
        path: "/repo",
        label: "Project",
        isMain: true,
        publicMetadata: { isJjRepo: true, isJjWorkspace: false },
      }),
    ]);
  });

  it("validates the base revision before creating and reports native failures", async () => {
    const parent = await temporaryDirectory("create parent");
    const destination = resolve(parent, "feature-x");
    const execFile = vi.fn<ExecFile>((request) => {
      const args = request.args ?? [];
      if (args.includes("log")) return Promise.resolve(commandResult({ stdout: "abcdef\n" }));
      if (args.includes("add")) return Promise.resolve(commandResult());
      return Promise.resolve(commandResult({ exitCode: 1, stderr: "unexpected command" }));
    });
    const provider = providerFor(execFile);

    const created = await provider.createWorkspace?.({
      project: project("/repo"),
      worktreeParentDir: parent,
      input: { name: "feature-x", baseRef: "main" },
      signal: new AbortController().signal,
    });

    expect(created).toMatchObject({
      key: destination,
      path: destination,
      label: "feature-x",
      isMain: false,
      publicMetadata: { isJjRepo: true, isJjWorkspace: true, workspace: "feature-x" },
    });
    expect(execFile).toHaveBeenCalledWith(expect.objectContaining({
      args: ["--ignore-working-copy", "log", "-r", "main", "--no-graph", "-T", 'commit_id.short() ++ "\\n"'],
    }));
    expect(execFile).toHaveBeenCalledWith(expect.objectContaining({
      file: "jj",
      args: ["workspace", "add", "--name", "feature-x", "--revision", "main", destination],
    }));
  });

  it("defaults the workspace name and refuses an unresolvable revision before creating", async () => {
    const parent = await temporaryDirectory("create default");
    const destination = resolve(parent, "plain");
    const execFile = vi.fn<ExecFile>((request) => {
      const args = request.args ?? [];
      if (args.includes("log")) return Promise.resolve(commandResult({ exitCode: 1, stderr: "Revision `nope` doesn't exist" }));
      if (args.includes("add")) return Promise.resolve(commandResult());
      return Promise.resolve(commandResult({ exitCode: 1 }));
    });
    const provider = providerFor(execFile);

    await expect(provider.createWorkspace?.({
      project: project("/repo"),
      worktreeParentDir: parent,
      input: { name: "plain", baseRef: "nope" },
      signal: new AbortController().signal,
    })).rejects.toThrow("Unable to resolve revision nope");

    expect(execFile.mock.calls.some(([request]) => (request.args ?? []).includes("add"))).toBe(false);

    const created = await provider.createWorkspace?.({
      project: project("/repo"),
      worktreeParentDir: parent,
      input: { name: "plain" },
      signal: new AbortController().signal,
    });
    expect(created).toMatchObject({ label: "plain", path: destination });
    expect(execFile).toHaveBeenCalledWith(expect.objectContaining({
      args: ["workspace", "add", "--name", "plain", destination],
    }));
  });

  it("surfaces the native add failure without pretending a workspace exists", async () => {
    const parent = await temporaryDirectory("create failure");
    const execFile = vi.fn<ExecFile>(() => Promise.resolve(commandResult({ exitCode: 1, stderr: "Error: Workspace named 'plain' already exists" })));
    const provider = providerFor(execFile);

    await expect(provider.createWorkspace?.({
      project: project("/repo"),
      worktreeParentDir: parent,
      input: { name: "plain" },
      signal: new AbortController().signal,
    })).rejects.toThrow("Unable to create Jujutsu workspace plain (exit 1): Error: Workspace named 'plain' already exists");
  });

  it("re-validates the live workspace and quotes the native removal command", async () => {
    const parent = await temporaryDirectory("removal");
    const target = resolve(parent, "feature's worktree");
    const execFile = vi.fn<ExecFile>((request) => {
      const args = request.args ?? [];
      if (args.includes("workspace")) {
        return Promise.resolve(commandResult({ stdout: `default\tznvutqtz\t/repo\n"feature's worktree"\tkmnopqrs\t${target}\n` }));
      }
      return Promise.resolve(commandResult({ stdout: "/repo\n" }));
    });
    const existing = new Set(["/repo", target]);
    const provider = providerFor(execFile, { isDirectory: (path) => Promise.resolve(existing.has(path)) });
    const workspace = (await provider.list(project("/repo"), new AbortController().signal)).find(({ path }) => path === target);
    if (workspace === undefined) throw new Error("Expected a removable Jujutsu workspace");

    await expect(provider.prepareRemove?.({
      project: project("/repo"),
      workspace,
      signal: new AbortController().signal,
    })).resolves.toEqual({
      title: "Delete workspace: feature's worktree",
      command: `jj workspace forget 'feature'\\''s worktree' && rm -rf '${target.replaceAll("'", "'\\''")}'`,
    });
  });

  it("refuses to plan removal of the main workspace or a renamed workspace", async () => {
    const execFile = vi.fn<ExecFile>((request) => {
      const args = request.args ?? [];
      if (args.includes("workspace")) {
        return Promise.resolve(commandResult({ stdout: "default\tznvutqtz\t/repo\nrenamed\tkmnopqrs\t/linked\n" }));
      }
      return Promise.resolve(commandResult({ stdout: "/repo\n" }));
    });
    const existing = new Set(["/repo", "/linked"]);
    const provider = providerFor(execFile, { isDirectory: (path) => Promise.resolve(existing.has(path)) });
    const workspaces = await provider.list(project("/repo"), new AbortController().signal);
    const main = workspaces.find(({ isMain }) => isMain);
    const linked = workspaces.find(({ path }) => path === "/linked");
    if (main === undefined || linked === undefined) throw new Error("Expected listed workspaces");

    await expect(provider.prepareRemove?.({
      project: project("/repo"),
      workspace: main,
      signal: new AbortController().signal,
    })).rejects.toThrow("A main Jujutsu workspace cannot be removed");

    await expect(provider.prepareRemove?.({
      project: project("/repo"),
      workspace: { ...linked, data: { workspaceName: "stale", root: "/linked" } },
      signal: new AbortController().signal,
    })).rejects.toThrow("Jujutsu workspace name changed since it was listed");
  });

  it("wins over a fallback provider for a claimed project", async () => {
    const execFile = vi.fn<ExecFile>((request) => {
      const args = request.args ?? [];
      if (args.includes("workspace")) return Promise.resolve(commandResult({ stdout: "default\tznvutqtz\t/repo\n" }));
      return Promise.resolve(commandResult({ stdout: "/repo\n" }));
    });
    const jjProvider = providerFor(execFile, { isDirectory: () => Promise.resolve(true) });
    const fallbackProvider: WorkspaceProvider = {
      fallback: true,
      probe: () => Promise.resolve("claim"),
      list: () => Promise.resolve([{ key: "git", path: "/git", label: "git", isMain: true }]),
    };
    const registry = new WorkspaceProviderRegistry({
      contributions: [contribution("jj", jjProvider), contribution("git", fallbackProvider)],
      logger: { warn: vi.fn() },
      pathInspector: () => true,
    });

    const resolution = await registry.resolve(project("/repo"));

    expect(resolution).toMatchObject({ status: "provider", ownerPluginId: "jj" });
  });
});

describe("parseJjWorkspaceList", () => {
  it("parses raw and quoted names and keeps tabs inside roots", () => {
    const output = [
      "default\tznvutqtz\t/repo",
      "\"feature one\"\tkmnopqrs\t/path with spaces",
      "\"has\\ttab\"\tjklmnopq\t/path\twith\ttabs",
    ].join("\n") + "\n";

    expect(parseJjWorkspaceList(output)).toEqual([
      { name: "default", changeId: "znvutqtz", root: "/repo" },
      { name: "feature one", changeId: "kmnopqrs", root: "/path with spaces" },
      { name: "has\ttab", changeId: "jklmnopq", root: "/path\twith\ttabs" },
    ]);
  });

  it("rejects a malformed line instead of silently dropping a workspace", () => {
    expect(() => parseJjWorkspaceList("default znvutqtz /repo\n")).toThrow("Unexpected jj workspace list line");
  });
});

describe("bundled Jujutsu provider against a real jj binary", () => {
  const binary = jjBinaryPath();

  it.skipIf(binary === undefined)("discovers, creates, and plans a working removal", async () => {
    const jj = requireBinary(binary);
    const root = await temporaryDirectory("real jj");
    const repo = join(root, "repo");
    const configPath = join(root, "jj-config.toml");
    await writeFile(configPath, 'user.name = "PI WEB Test"\nuser.email = "pi-web@example.invalid"\n', "utf8");
    const env: NodeJS.ProcessEnv = { ...process.env, JJ_CONFIG: configPath };
    runJj(jj, root, ["git", "init", repo], env);

    const execFile = createServerPluginExecFile({ env });
    const provider = providerFor(execFile);
    const input = project(repo);

    await expect(provider.probe(input, new AbortController().signal)).resolves.toBe("claim");
    const listed = await provider.list(input, new AbortController().signal);
    expect(listed).toEqual([expect.objectContaining({ path: repo, label: "default", isMain: true })]);

    const parent = join(root, "worktrees");
    const created = await provider.createWorkspace?.({
      project: input,
      worktreeParentDir: parent,
      input: { name: "feature-x" },
      signal: new AbortController().signal,
    });
    const createdPath = join(parent, "feature-x");
    expect(created).toMatchObject({ path: createdPath, label: "feature-x", isMain: false });
    expect(existsSync(createdPath)).toBe(true);

    const afterCreate = await provider.list(input, new AbortController().signal);
    expect(afterCreate.map(({ path, isMain }) => ({ path, isMain }))).toEqual([
      { path: repo, isMain: true },
      { path: createdPath, isMain: false },
    ]);

    const plan = await provider.prepareRemove?.({
      project: input,
      workspace: requireWorkspace(afterCreate.find(({ path }) => path === createdPath)),
      signal: new AbortController().signal,
    });
    expect(plan?.command).toContain("jj workspace forget");

    const command = plan?.command;
    if (command === undefined) throw new Error("Expected a removal command");
    execFileSync("bash", ["-lc", command], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
    expect(existsSync(createdPath)).toBe(false);
    const afterRemove = await provider.list(input, new AbortController().signal);
    expect(afterRemove.map(({ path }) => path)).toEqual([repo]);
  });
});

type ExecFile = ServerPluginActivationContext["execFile"];

function contextFor(execFile: ExecFile): ServerPluginActivationContext {
  return {
    apiVersion: 3,
    pluginId: "jj",
    packageRoot: resolve("pi-web-plugins/jj"),
    dataDirectory: "/data/plugin-data/jj",
    logger: {
      debug() { /* no-op */ },
      info() { /* no-op */ },
      warn() { /* no-op */ },
      error() { /* no-op */ },
    },
    settings: {},
    execFile,
    signal: new AbortController().signal,
    lifetimeSignal: new AbortController().signal,
  };
}

function providerFor(execFile: ExecFile, options?: JjWorkspaceProviderOptions): WorkspaceProvider {
  return createJjWorkspaceProvider(contextFor(execFile), options);
}

function requiredProvider(activation: ServerPluginActivation): WorkspaceProvider {
  const provider = activation.workspaceProvider;
  if (provider === undefined) throw new Error("Bundled Jujutsu did not activate its workspace provider");
  return provider;
}

function missingExecutable(): ExecFile {
  return () => Promise.reject(Object.assign(new Error("spawn jj ENOENT"), { code: "ENOENT" }));
}

function contribution(pluginId: string, workspaceProvider: WorkspaceProvider): ServerPluginProviderContribution {
  return {
    pluginId,
    pluginName: pluginId,
    packageRoot: `/plugins/${pluginId}`,
    source: "test fixture",
    scope: "local",
    moduleRevision: "1",
    provider: workspaceProvider,
  };
}

function project(path: string): ProjectInput & Project {
  return { id: "project-1", name: "Project", path, createdAt: "2026-07-27T00:00:00.000Z" };
}

function requireWorkspace(workspace: Parameters<NonNullable<WorkspaceProvider["prepareRemove"]>>[0]["workspace"] | undefined): Parameters<NonNullable<WorkspaceProvider["prepareRemove"]>>[0]["workspace"] {
  if (workspace === undefined) throw new Error("Expected a listed workspace");
  return workspace;
}

async function temporaryDirectory(label: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), `pi-web-jj-provider-${label.replaceAll(" ", "-")}-`));
  tempRoots.push(path);
  return path;
}

function commandResult(overrides: Partial<ServerPluginExecFileResult> = {}): ServerPluginExecFileResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    ...overrides,
  };
}

function jjBinaryPath(): string | undefined {
  const configured = process.env["PI_WEB_TEST_JJ"];
  const candidates = configured === undefined || configured === "" ? ["jj"] : [configured, "jj"];
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

function requireBinary(binary: string | undefined): string {
  if (binary === undefined) throw new Error("A real jj binary is required for this test");
  return binary;
}

function runJj(binary: string, cwd: string, args: readonly string[], env: NodeJS.ProcessEnv): void {
  execFileSync(binary, [...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
}