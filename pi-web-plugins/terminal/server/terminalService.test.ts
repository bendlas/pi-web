import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerPluginNoticeInput } from "@jmfederico/pi-web/server-plugin-api";
import { interactiveShellArgs, TerminalService, type TerminalActivitySink, type TerminalInfo, type TerminalScope, type TerminalWorkspaceScope } from "./terminalService";
import { createDefaultPtyProvider } from "./ptyComposition.js";

describe("interactive shell arguments", () => {
  it.each([
    { shell: "bash", expected: ["-l"] },
    { shell: "/usr/local/bin/zsh", expected: ["-l"] },
    { shell: "/opt/homebrew/bin/fish", expected: ["-l"] },
    { shell: String.raw`C:\Program Files\Git\bin\bash.exe`, expected: ["-l"] },
    { shell: "/bin/dash", expected: [] },
    { shell: "pwsh", expected: [] },
    { shell: "powershell.exe", expected: [] },
    { shell: "cmd.exe", expected: [] },
  ])("uses login mode only for a supported shell: $shell", ({ shell, expected }) => {
    expect(interactiveShellArgs(shell)).toEqual(expected);
  });
});

// TerminalService spawns a POSIX shell (/bin/bash with -lc and commands like
// printf/true/exit). The terminal feature is not supported on native Windows,
// so these tests are skipped there rather than asserting Unix shell behavior.
describe.skipIf(process.platform === "win32")("TerminalService command runs", () => {
  it("retains the host execution snapshot for new and continued maintenance PTYs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-web-maintenance-env-"));
    const service = new TerminalService(createDefaultPtyProvider());
    const env = { ...process.env, SHELL: "/bin/sh", EXECUTION_MARKER: "captured", PI_WEB_CONFIG: join(directory, "config.json") };
    try {
      service.bindMaintenanceExecutionContext({ cwd: join(directory, "maintenance"), env });
      env.EXECUTION_MARKER = "mutated";
      vi.stubEnv("EXECUTION_MARKER", "ambient");
      vi.stubEnv("SHELL", "/missing/shell");
      const maintenance = service.maintenanceScope();
      const command = 'printf "MARKER=%s CONFIG=%s TERM=%s TERMINAL=%s\\n" "$EXECUTION_MARKER" "$PI_WEB_CONFIG" "$TERM" "$PI_WEB_TERMINAL"';
      const run = service.runCommand({ ...maintenance, origin: "updates", title: "Paths", command });
      const output = await terminalExit(service, run.terminalId, maintenance);
      const expected = `MARKER=captured CONFIG=${env.PI_WEB_CONFIG} TERM=xterm-256color TERMINAL=1`;
      expect(output).toContain(expected);
      service.continue(maintenance, run.terminalId);
      const continuedExit = terminalExit(service, run.terminalId, maintenance);
      service.write(maintenance, run.terminalId, `${command}\nexit\n`);
      expect(await continuedExit).toContain(expected);
      const next = service.runCommand({ ...maintenance, origin: "updates", title: "Again", command });
      expect(await terminalExit(service, next.terminalId, maintenance)).toContain(expected);
    } finally {
      service.dispose();
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps workspace commands on the current environment without resolving their relative overrides", async () => {
    const service = new TerminalService(createDefaultPtyProvider());
    try {
      service.bindMaintenanceExecutionContext({ cwd: process.cwd(), env: { ...process.env, PI_WEB_CONFIG: "/maintenance/config.json" } });
      vi.stubEnv("SHELL", "/bin/sh");
      for (const config of ["relative-first.json", "relative-second.json"]) {
        vi.stubEnv("PI_WEB_CONFIG", config);
        const run = service.runCommand({ ...scope(), origin: "test", title: "Workspace", command: 'printf "CONFIG=%s\\n" "$PI_WEB_CONFIG"' });
        expect(await terminalExit(service, run.terminalId)).toContain(`CONFIG=${config}`);
      }
    } finally {
      service.dispose();
      vi.unstubAllEnvs();
    }
  });

  it("reports maintenance directory creation failures without retaining a run", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-web-maintenance-blocked-"));
    const service = new TerminalService(createDefaultPtyProvider());
    try {
      const blocked = join(directory, "file");
      await writeFile(blocked, "not a directory");
      service.bindMaintenanceExecutionContext({ cwd: join(blocked, "maintenance"), env: { ...process.env } });
      expect(() => service.runCommand({ ...service.maintenanceScope(), origin: "test", title: "Blocked", command: "true" })).toThrow();
      expect(service.listCommandRuns()).toEqual([]);
      expect(service.list(service.maintenanceScope())).toEqual([]);
    } finally {
      service.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps an exited maintenance terminal intact when Continue cannot prepare its cwd", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-web-maintenance-continue-"));
    const service = new TerminalService(createDefaultPtyProvider());
    try {
      const cwd = join(directory, "maintenance");
      service.bindMaintenanceExecutionContext({ cwd, env: { ...process.env, SHELL: "/bin/sh" } });
      const scope = service.maintenanceScope();
      const run = service.runCommand({ ...scope, origin: "test", title: "Exit", command: "exit 7" });
      await terminalExit(service, run.terminalId, scope);
      const completed = service.get(scope, run.terminalId);
      await rm(cwd, { recursive: true });
      await writeFile(cwd, "not a directory");
      expect(() => service.continue(scope, run.terminalId)).toThrow();
      expect(service.get(scope, run.terminalId)).toEqual(completed);
      expect(service.getCommandRun(run.id)).toMatchObject({ status: "failed", exitCode: 7 });
    } finally {
      service.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("closes all terminal records for a cwd", () => {
    const service = new TerminalService(createDefaultPtyProvider());
    try {
      const terminal = service.create(scope());
      let closed = 0;
      service.attach(scope(), terminal.id, {
        output: () => undefined,
        exit: () => undefined,
        closed: () => { closed += 1; },
      });

      service.closeForCwd(process.cwd());

      expect(closed).toBe(1);
      expect(service.get(scope(), terminal.id)).toBeUndefined();
      expect(service.list(scope())).toEqual([]);
    } finally {
      service.dispose();
    }
  });

  it("closes all terminals only in the requested workspace when cwd values match", () => {
    const service = new TerminalService(createDefaultPtyProvider());
    const firstScope = scope();
    const secondScope = { ...firstScope, projectId: "p2", workspaceId: "w2" };
    try {
      const first = service.create(firstScope);
      const second = service.create(secondScope);
      let firstClosed = 0;
      service.attach(firstScope, first.id, {
        output: () => undefined,
        exit: () => undefined,
        closed: () => { firstClosed += 1; },
      });

      service.closeAll(firstScope);

      expect(firstClosed).toBe(1);
      expect(service.get(firstScope, first.id)).toBeUndefined();
      expect(service.get(secondScope, second.id)).toMatchObject({ id: second.id, cwd: secondScope.cwd });
    } finally {
      service.dispose();
    }
  });

  it("loads login-profile PATH entries in new interactive terminals", async () => {
    await withBashLoginProfile(async () => {
      const service = new TerminalService(createDefaultPtyProvider());
      try {
        const terminal = service.create(scope());
        const exit = terminalExit(service, terminal.id);

        service.write(scope(), terminal.id, `${LOGIN_PROFILE_COMMAND}\nexit\n`);

        expect(await exit).toContain(LOGIN_PROFILE_OUTPUT);
      } finally {
        service.dispose();
      }
    });
  });

  it("loads login-profile PATH entries in continued interactive terminals", async () => {
    await withBashLoginProfile(async () => {
      const service = new TerminalService(createDefaultPtyProvider());
      try {
        const run = service.runCommand({
          origin: "core",
          projectId: "p1",
          workspaceId: "w1",
          cwd: process.cwd(),
          title: "Done command",
          command: "true",
        });
        await terminalExit(service, run.terminalId);

        service.continue(scope(), run.terminalId);
        const shellReady = firstLiveTerminalOutput(service, run.terminalId);
        const exit = terminalExit(service, run.terminalId);
        await shellReady;
        service.write(scope(), run.terminalId, `${LOGIN_PROFILE_COMMAND}\nexit\n`);

        expect(await exit).toContain(LOGIN_PROFILE_OUTPUT);
      } finally {
        service.dispose();
      }
    });
  });

  describe("PI_WEB_TERMINAL propagation", () => {
    let originalPiWebTerminal: string | undefined;

    beforeEach(() => {
      originalPiWebTerminal = process.env["PI_WEB_TERMINAL"];
      process.env["PI_WEB_TERMINAL"] = "conflicting-parent-value";
    });

    afterEach(() => {
      if (originalPiWebTerminal === undefined) {
        delete process.env["PI_WEB_TERMINAL"];
      } else {
        process.env["PI_WEB_TERMINAL"] = originalPiWebTerminal;
      }
    });

    it("sets PI_WEB_TERMINAL for terminal commands", async () => {
      const service = new TerminalService(createDefaultPtyProvider());
      try {
        const frame = "__PI_WEB_RUN_ENV_7F3A9C__";
        const run = service.runCommand({
          origin: "core",
          projectId: "p1",
          workspaceId: "w1",
          cwd: process.cwd(),
          title: "Environment check",
          command: `printf '${frame}%s${frame}\\n' "$PI_WEB_TERMINAL"`,
        });

        expect(await terminalExit(service, run.terminalId)).toContain(`${frame}1${frame}`);
      } finally {
        service.dispose();
      }
    });

    it("sets PI_WEB_TERMINAL in a continued interactive shell", async () => {
      const service = new TerminalService(createDefaultPtyProvider());
      try {
        const run = service.runCommand({
          origin: "core",
          projectId: "p1",
          workspaceId: "w1",
          cwd: process.cwd(),
          title: "Done command",
          command: "true",
        });
        await terminalExit(service, run.terminalId);

        const continued = service.continue(scope(), run.terminalId);

        expect(continued).toMatchObject({ id: run.terminalId, exited: false });
        expect(continued.commandRunId).toBeUndefined();
        expect(service.get(scope(), run.terminalId)?.commandRunId).toBeUndefined();

        const frame = "__PI_WEB_CONTINUE_ENV_42D8B1__";
        const shellReady = firstLiveTerminalOutput(service, run.terminalId);
        const exit = terminalExit(service, run.terminalId);
        await shellReady;
        service.write(scope(), run.terminalId, `printf '${frame}%s${frame}\\n' "$PI_WEB_TERMINAL"\nexit\n`);

        const output = await exit;
        expect(output).toContain("[continued in interactive shell]");
        expect(output).toContain(`${frame}1${frame}`);
      } finally {
        service.dispose();
      }
    });
  });

  it("tracks dedicated terminal command runs through completion", async () => {
    const service = new TerminalService(createDefaultPtyProvider());
    try {
      const run = service.runCommand({
        origin: "core",
        projectId: "p1",
        workspaceId: "w1",
        cwd: process.cwd(),
        title: "Test command",
        command: "printf 'hello'",
        metadata: { "pi.operation": "test" },
      });

      expect(run).toMatchObject({ status: "running", origin: "core", projectId: "p1", workspaceId: "w1", metadata: { "pi.operation": "test" } });
      expect(service.get(scope(), run.terminalId)).toMatchObject({ commandRunId: run.id });
      expect(service.listCommandRuns({ metadata: { "pi.operation": "test" } })).toHaveLength(1);

      const output = await terminalExit(service, run.terminalId);

      expect(output).toContain("$ printf 'hello'");
      expect(output).toContain("hello");
      expect(service.getCommandRun(run.id)).toMatchObject({ status: "succeeded", exitCode: 0, terminalId: run.terminalId });
      expect(service.listCommandRuns({ statuses: ["succeeded"] }).map((candidate) => candidate.id)).toEqual([run.id]);
    } finally {
      service.dispose();
    }
  });

  it("marks failed command runs when the command exits non-zero", async () => {
    const service = new TerminalService(createDefaultPtyProvider());
    try {
      const run = service.runCommand({
        origin: "core",
        projectId: "p1",
        workspaceId: "w1",
        cwd: process.cwd(),
        title: "Failing command",
        command: "exit 7",
      });

      await terminalExit(service, run.terminalId);

      expect(service.getCommandRun(run.id)).toMatchObject({ status: "failed", exitCode: 7 });
    } finally {
      service.dispose();
    }
  });

  it("records one host-attributed intent when a command fails", async () => {
    const records: ServerPluginNoticeInput[] = [];
    const service = new TerminalService(createDefaultPtyProvider(), (input) => { records.push(input); });
    try {
      const run = service.runCommand({
        origin: "core",
        projectId: "p1",
        workspaceId: "w1",
        cwd: process.cwd(),
        title: "Remove workspace",
        command: "exit 7",
        failureNotice: {
          message: "Workspace removal failed. See terminal output.",
          context: { targetWorkspaceId: "target-workspace" },
          presentation: { kind: "workspaceRemovalCommandFailed" },
        },
      });

      await terminalExit(service, run.terminalId);

      expect(run).not.toHaveProperty("failureNotice");
      expect(service.getCommandRun(run.id)).not.toHaveProperty("failureNotice");
      expect(records).toEqual([{
        severity: "error",
        message: "Workspace removal failed. See terminal output.",
        scope: { projectId: "p1" },
        presentation: { kind: "workspaceRemovalCommandFailed" },
        context: {
          commandRunId: run.id,
          targetWorkspaceId: "target-workspace",
        },
      }]);
    } finally {
      service.dispose();
    }
  });

  it("does not record a failure intent for a successful command", async () => {
    const records: ServerPluginNoticeInput[] = [];
    const service = new TerminalService(createDefaultPtyProvider(), (input) => { records.push(input); });
    try {
      const run = service.runCommand({
        origin: "core",
        projectId: "p1",
        workspaceId: "w1",
        cwd: process.cwd(),
        title: "Remove workspace",
        command: "true",
        failureNotice: {
          message: "Workspace removal failed. See terminal output.",
          context: { targetWorkspaceId: "target-workspace" },
        },
      });

      await terminalExit(service, run.terminalId);

      expect(service.getCommandRun(run.id)).toMatchObject({ status: "succeeded", exitCode: 0 });
      expect(records).toEqual([]);
    } finally {
      service.dispose();
    }
  });

  it("publishes workspace activity updates across the terminal lifecycle", async () => {
    const workspaceActivity = createWorkspaceActivityRecorder();
    const service = new TerminalService(createDefaultPtyProvider());
    service.bindActivitySink(workspaceActivity);
    const cwd = process.cwd();
    try {
      const run = service.runCommand({
        origin: "core",
        projectId: "p1",
        workspaceId: "w1",
        cwd,
        title: "Lifecycle command",
        command: "true",
      });
      expect(requireTerminal(service, run.terminalId).exited).toBe(false);
      expect(workspaceActivity.updated).toEqual([{ id: run.terminalId, cwd, exited: false }]);

      await terminalExit(service, run.terminalId);
      expect(requireTerminal(service, run.terminalId).exited).toBe(true);

      expect(workspaceActivity.updated).toEqual([
        { id: run.terminalId, cwd, exited: false },
        { id: run.terminalId, cwd, exited: true },
      ]);

      service.close(scope(), run.terminalId);

      expect(workspaceActivity.removed).toEqual([{ terminalId: run.terminalId, cwd }]);
    } finally {
      service.dispose();
    }
  });
});

// A pty is created with forkpty, so the shell leads the process group and the
// command started in it is the terminal's child. Closing the terminal hangs the
// shell up, like closing a real terminal window: an interactive shell forwards
// SIGHUP to the job it started, while a job the user disowned keeps running.
describe.skipIf(process.platform === "win32")("terminal close process handling", () => {
  it("terminates a running command's child when the terminal is closed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-term-close-run-"));
    const service = new TerminalService();
    let childPid: number | undefined;
    try {
      const run = service.runCommand({
        origin: "core",
        projectId: "p1",
        workspaceId: "w1",
        cwd: process.cwd(),
        title: "Long-running command",
        // Background the process and `wait` for it so the shell stays alive.
        // Without job control the child shares the shell's process group.
        command: `${longRunningChildCommand(join(dir, "child.pid"))} & wait`,
      });
      childPid = await readChildPid(join(dir, "child.pid"));
      expect(processIsAlive(childPid)).toBe(true);

      service.close(scope(), run.terminalId);

      await expectProcessExit(childPid);
    } finally {
      killIfAlive(childPid);
      service.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("terminates a foreground process when an interactive terminal is closed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-term-close-fg-"));
    const service = new TerminalService();
    let childPid: number | undefined;
    try {
      const terminal = await openInteractiveTerminal(service);
      terminal.write(`${longRunningChildCommand(join(dir, "child.pid"))}\n`);
      childPid = await readChildPid(join(dir, "child.pid"));
      expect(processIsAlive(childPid)).toBe(true);

      terminal.close();

      await expectProcessExit(childPid);
    } finally {
      killIfAlive(childPid);
      service.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("terminates a backgrounded process when an interactive terminal is closed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-term-close-bg-"));
    const service = new TerminalService();
    let childPid: number | undefined;
    try {
      const terminal = await openInteractiveTerminal(service);
      terminal.write(`${longRunningChildCommand(join(dir, "child.pid"))} &\n`);
      childPid = await readChildPid(join(dir, "child.pid"));
      expect(processIsAlive(childPid)).toBe(true);

      terminal.close();

      // An interactive shell forwards SIGHUP to the jobs in its table, so a
      // backgrounded job dies with the terminal.
      await expectProcessExit(childPid);
    } finally {
      killIfAlive(childPid);
      service.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("leaves a disowned process running when an interactive terminal is closed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-term-close-disown-"));
    const service = new TerminalService();
    let childPid: number | undefined;
    try {
      const terminal = await openInteractiveTerminal(service);
      terminal.write(`${longRunningChildCommand(join(dir, "child.pid"))}\n`);
      childPid = await readChildPid(join(dir, "child.pid"));
      expect(processIsAlive(childPid)).toBe(true);

      terminal.write("\x1a"); // C-z stops the foreground job.
      await expectProcessStopped(childPid);
      // Round-trip a marker before `bg` so the shell has finished its
      // job-control bookkeeping and the stopped job is ready to resume. The
      // arithmetic makes the marker distinct from the echoed input line.
      terminal.write("echo __PI_WEB_AFTER_STOP__$((6*7))\n");
      await waitForTerminalOutput(service, terminal.terminalId, "__PI_WEB_AFTER_STOP__42");
      terminal.write("bg\n");
      await expectProcessRunning(childPid);
      terminal.write("disown; echo __PI_WEB_DISOWNED__$((7*6))\n");
      await waitForTerminalOutput(service, terminal.terminalId, "__PI_WEB_DISOWNED__42");
      expect(processIsAlive(childPid)).toBe(true);

      terminal.close();

      await delay(500);
      // A disowned job has left the shell's job table, so the hangup does not
      // reach it and it survives the terminal.
      // FIXME: it is only orphaned, not inherited and reaped by the session
      // daemon, so it outlives the daemon that should own it.
      expect(processIsAlive(childPid)).toBe(true);
    } finally {
      killIfAlive(childPid);
      service.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

interface WorkspaceActivityRecorder extends TerminalActivitySink {
  readonly updated: TerminalActivityUpdate[];
  readonly removed: TerminalActivityRemoval[];
}

type TerminalActivityUpdate = Pick<TerminalInfo, "id" | "cwd" | "exited">;

interface TerminalActivityRemoval {
  terminalId: string;
  cwd: string | undefined;
}

function createWorkspaceActivityRecorder(): WorkspaceActivityRecorder {
  const updated: TerminalActivityUpdate[] = [];
  const removed: TerminalActivityRemoval[] = [];
  return {
    updated,
    removed,
    updateTerminal: (terminal) => {
      updated.push({ id: terminal.id, cwd: terminal.cwd, exited: terminal.exited });
    },
    removeTerminal: (terminalId, cwd) => {
      removed.push({ terminalId, cwd });
    },
  };
}

function requireTerminal(service: TerminalService, terminalId: string): TerminalInfo {
  const terminal = service.get(scope(), terminalId);
  if (terminal === undefined) throw new Error(`Expected terminal ${terminalId} to exist`);
  return terminal;
}

const LOGIN_PROFILE_COMMAND = "pi-web-test-login-profile-command";
const LOGIN_PROFILE_OUTPUT = "__PI_WEB_LOGIN_PROFILE_PATH_COMMAND__";

async function withBashLoginProfile(run: () => Promise<void>): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "pi-web-terminal-home-"));
  const profileBin = join(home, "profile-bin");
  await mkdir(profileBin);
  const commandPath = join(profileBin, LOGIN_PROFILE_COMMAND);
  await writeFile(commandPath, `#!/bin/sh\nprintf '%s\\n' '${LOGIN_PROFILE_OUTPUT}'\n`);
  await chmod(commandPath, 0o755);
  await writeFile(join(home, ".bash_profile"), `export PATH="$HOME/profile-bin:$PATH"\n`);

  const originalHome = process.env["HOME"];
  const originalShell = process.env["SHELL"];
  process.env["HOME"] = home;
  process.env["SHELL"] = "/bin/bash";
  try {
    await run();
  } finally {
    restoreEnv("HOME", originalHome);
    restoreEnv("SHELL", originalShell);
    await rm(home, { recursive: true, force: true });
  }
}

function restoreEnv(key: "HOME" | "SHELL", value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, key);
  else process.env[key] = value;
}

function firstLiveTerminalOutput(service: TerminalService, terminalId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let detach = (): void => undefined;
    const finish = (callback: () => void): void => {
      detach();
      callback();
    };
    try {
      detach = service.attach(scope(), terminalId, {
        output: (_data, replay) => {
          if (!replay) finish(resolve);
        },
        exit: () => { finish(() => { reject(new Error("Continued terminal exited before its shell became ready")); }); },
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function terminalExit(service: TerminalService, terminalId: string, terminalScope: TerminalScope = scope()): Promise<string> {
  const output: string[] = [];
  return new Promise((resolve, reject) => {
    try {
      service.attach(terminalScope, terminalId, {
        output: (data) => { output.push(data); },
        exit: () => { resolve(output.join("")); },
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function scope(cwd = process.cwd()): TerminalWorkspaceScope {
  return { projectId: "p1", workspaceId: "w1", cwd };
}

interface InteractiveTerminal {
  terminalId: string;
  write(data: string): void;
  close(): void;
}

async function openInteractiveTerminal(service: TerminalService): Promise<InteractiveTerminal> {
  const terminal = service.create(scope());
  await firstLiveTerminalOutput(service, terminal.id);
  return {
    terminalId: terminal.id,
    write: (data) => { service.write(scope(), terminal.id, data); },
    close: () => { service.close(scope(), terminal.id); },
  };
}

function longRunningChildCommand(pidPath: string): string {
  return `node -e 'require("fs").writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); setInterval(() => {}, 1000)'`;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readChildPid(pidPath: string): Promise<number> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      return Number(await readFile(pidPath, "utf8"));
    } catch {
      await delay(20);
    }
  }
  throw new Error(`Child pid file ${pidPath} never appeared`);
}

async function expectProcessExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (!processIsAlive(pid)) return;
    await delay(20);
  }
  throw new Error(`Process ${String(pid)} survived terminal close`);
}

function processState(pid: number): string | undefined {
  try {
    const state = execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).trim();
    return state === "" ? undefined : state;
  } catch {
    return undefined;
  }
}

async function expectProcessStopped(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (processState(pid)?.includes("T") === true) return;
    await delay(20);
  }
  throw new Error(`Process ${String(pid)} was never stopped`);
}

async function expectProcessRunning(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = processState(pid);
    if (state !== undefined && !state.includes("T")) return;
    await delay(20);
  }
  throw new Error(`Process ${String(pid)} was never resumed`);
}

/** Resolves once `text` has reached the terminal, whether through replay or live output. */
function waitForTerminalOutput(service: TerminalService, terminalId: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let detach: (() => void) | undefined;
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      detach?.();
      callback();
    };
    try {
      detach = service.attach(scope(), terminalId, {
        output: (data) => { if (data.includes(text)) finish(resolve); },
        exit: () => { finish(() => { reject(new Error("Terminal exited before its output appeared")); }); },
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function killIfAlive(pid: number | undefined): void {
  if (pid === undefined || !processIsAlive(pid)) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // The process exited after the liveness check.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}
