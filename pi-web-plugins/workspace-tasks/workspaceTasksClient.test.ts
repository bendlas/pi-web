import { describe, expect, it, vi } from "vitest";
import {
  LEGACY_TASKS_CONFIG_PATH,
  SCRIPTS_CONFIG_PATH,
  loadWorkspaceTasksConfig,
  type WorkspaceTasksFileReader,
} from "./workspaceTasksClient";

const missingFile = () => Promise.reject(new Error("Path does not exist"));
const fileContent = (content: string) => ({ content, truncated: false, binary: false });

function reader(
  files: Readonly<Record<string, { content: string; truncated: boolean; binary: boolean }>>,
  writeFile?: WorkspaceTasksFileReader["writeFile"],
): WorkspaceTasksFileReader {
  return {
    readFile: (path) => {
      const file = files[path];
      return file === undefined ? missingFile() : Promise.resolve(file);
    },
    ...(writeFile === undefined ? {} : { writeFile }),
  };
}

describe("workspace scripts client", () => {
  it("loads the canonical scripts path through the public workspace file helper", async () => {
    const readFile = vi.fn<WorkspaceTasksFileReader["readFile"]>(() => Promise.resolve(fileContent(JSON.stringify({ version: 1, tasks: [] }))));

    await loadWorkspaceTasksConfig({ readFile });

    expect(readFile).toHaveBeenCalledWith(SCRIPTS_CONFIG_PATH);
  });

  it("loads and parses a valid scripts config", async () => {
    const files = reader({
      [SCRIPTS_CONFIG_PATH]: fileContent(JSON.stringify({ version: 1, tasks: [{ id: "build", title: "Build", command: "npm run build" }] })),
    });

    await expect(loadWorkspaceTasksConfig(files)).resolves.toEqual({
      kind: "loaded",
      path: SCRIPTS_CONFIG_PATH,
      config: {
        version: 1,
        tasks: [{ id: "build", title: "Build", command: "npm run build", confirm: false }],
      },
    });
  });

  it("treats a missing optional scripts config as unconfigured", async () => {
    const files: WorkspaceTasksFileReader = { readFile: missingFile };

    await expect(loadWorkspaceTasksConfig(files)).resolves.toEqual({
      kind: "missing",
      message: "No workspace scripts configured here.",
      hint: `${SCRIPTS_CONFIG_PATH} is optional. Create it in this workspace if you want custom scripts.`,
    });
  });

  it("reads a legacy tasks config and copies it to the canonical path", async () => {
    const writeFile = vi.fn<NonNullable<WorkspaceTasksFileReader["writeFile"]>>(() => Promise.resolve({}));
    const files = reader({
      [LEGACY_TASKS_CONFIG_PATH]: fileContent(JSON.stringify({ version: 1, tasks: [{ id: "build", title: "Build", command: "npm run build" }] })),
    }, writeFile);

    await expect(loadWorkspaceTasksConfig(files)).resolves.toMatchObject({
      kind: "loaded",
      path: SCRIPTS_CONFIG_PATH,
      config: { tasks: [{ id: "build" }] },
    });
    expect(writeFile).toHaveBeenCalledOnce();
    expect(writeFile.mock.calls[0]?.[0]).toBe(SCRIPTS_CONFIG_PATH);
    expect(writeFile.mock.calls[0]?.[2]).toEqual({ overwrite: false });
  });

  it("still loads a legacy config when the file API cannot write", async () => {
    const files = reader({
      [LEGACY_TASKS_CONFIG_PATH]: fileContent(JSON.stringify({ version: 1, tasks: [{ id: "build", title: "Build", command: "npm run build" }] })),
    });

    await expect(loadWorkspaceTasksConfig(files)).resolves.toMatchObject({ kind: "loaded", path: SCRIPTS_CONFIG_PATH });
  });

  it("does not fail the load when opportunistic migration write fails", async () => {
    const writeFile = vi.fn<NonNullable<WorkspaceTasksFileReader["writeFile"]>>(() => Promise.reject(new Error("nope")));
    const files = reader({
      [LEGACY_TASKS_CONFIG_PATH]: fileContent(JSON.stringify({ version: 1, tasks: [] })),
    }, writeFile);

    await expect(loadWorkspaceTasksConfig(files)).resolves.toMatchObject({ kind: "loaded" });
  });

  it("returns a visible unavailable state instead of throwing on read failures", async () => {
    const files: WorkspaceTasksFileReader = { readFile: () => Promise.reject(new Error("nope")) };

    await expect(loadWorkspaceTasksConfig(files)).resolves.toMatchObject({
      kind: "unavailable",
      message: "Could not load workspace scripts.",
      hint: `Fix ${SCRIPTS_CONFIG_PATH}, then click Refresh.`,
      detail: `Unable to read ${SCRIPTS_CONFIG_PATH}: nope`,
    });
  });

  it("returns parser details for invalid config files", async () => {
    const files = reader({
      [SCRIPTS_CONFIG_PATH]: fileContent(JSON.stringify({ version: 2, tasks: [] })),
    });

    await expect(loadWorkspaceTasksConfig(files)).resolves.toMatchObject({
      kind: "unavailable",
      detail: "Config version must be 1",
    });
  });
});
