import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadGlobalTasksConfig } from "./globalTasksServer.js";

describe("global tasks server reader", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "pi-global-tasks-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns missing when tasks.json does not exist", async () => {
    await expect(loadGlobalTasksConfig(dir)).resolves.toMatchObject({
      kind: "missing",
      message: "No global tasks configured.",
    });
  });

  it("loads and parses a valid tasks.json", async () => {
    await writeFile(
      join(dir, "tasks.json"),
      JSON.stringify({ version: 1, tasks: [{ id: "git.log-oneline", title: "Git log", command: "git log --format=oneline" }] }),
      "utf8",
    );
    const result = await loadGlobalTasksConfig(dir);
    expect(result).toMatchObject({
      kind: "loaded",
      config: { tasks: [{ id: "git.log-oneline", title: "Git log", command: "git log --format=oneline", confirm: false }] },
      path: join(dir, "tasks.json"),
    });
  });

  it("reuses the shared parser so version/duplicate rules still apply", async () => {
    await writeFile(join(dir, "tasks.json"), JSON.stringify({ version: 2, tasks: [] }), "utf8");
    await expect(loadGlobalTasksConfig(dir)).resolves.toMatchObject({
      kind: "unavailable",
      detail: "Config version must be 1",
    });
  });

  it("reports invalid JSON through the unavailable state without throwing", async () => {
    await writeFile(join(dir, "tasks.json"), "{ not json", "utf8");
    await expect(loadGlobalTasksConfig(dir)).resolves.toMatchObject({
      kind: "unavailable",
      message: "Could not load global tasks.",
    });
  });
});
