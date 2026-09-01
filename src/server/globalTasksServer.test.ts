import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGlobalTasksConfig } from "./globalTasksServer.js";

describe("global scripts server reader", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pi-global-scripts-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns missing when neither scripts.json nor legacy tasks.json exists", async () => {
    await expect(loadGlobalTasksConfig(dir)).resolves.toMatchObject({
      kind: "missing",
      message: "No global scripts configured.",
    });
  });

  it("loads and parses a canonical scripts.json", async () => {
    await writeFile(
      join(dir, "scripts.json"),
      JSON.stringify({ version: 1, tasks: [{ id: "git.log-oneline", title: "Git log", command: "git log --format=oneline" }] }),
      "utf8",
    );
    const result = await loadGlobalTasksConfig(dir);
    expect(result).toMatchObject({
      kind: "loaded",
      config: { tasks: [{ id: "git.log-oneline", title: "Git log", command: "git log --format=oneline", confirm: false }] },
      path: join(dir, "scripts.json"),
    });
  });

  it("reads a legacy tasks.json and migrates it to scripts.json", async () => {
    const legacy = JSON.stringify({ version: 1, tasks: [{ id: "git.log-oneline", title: "Git log", command: "git log --format=oneline" }] });
    await writeFile(join(dir, "tasks.json"), legacy, "utf8");

    const result = await loadGlobalTasksConfig(dir);

    expect(result).toMatchObject({ kind: "loaded", path: join(dir, "scripts.json") });
    await expect(readFile(join(dir, "scripts.json"), "utf8")).resolves.toBe(legacy);
  });

  it("prefers the canonical scripts.json over a legacy tasks.json", async () => {
    await writeFile(join(dir, "scripts.json"), JSON.stringify({ version: 1, tasks: [{ id: "canonical", title: "Canonical", command: "true" }] }), "utf8");
    await writeFile(join(dir, "tasks.json"), JSON.stringify({ version: 1, tasks: [{ id: "legacy", title: "Legacy", command: "true" }] }), "utf8");

    await expect(loadGlobalTasksConfig(dir)).resolves.toMatchObject({
      kind: "loaded",
      config: { tasks: [{ id: "canonical" }] },
    });
  });

  it("reuses the shared parser so version/duplicate rules still apply", async () => {
    await writeFile(join(dir, "scripts.json"), JSON.stringify({ version: 2, tasks: [] }), "utf8");
    await expect(loadGlobalTasksConfig(dir)).resolves.toMatchObject({
      kind: "unavailable",
      detail: "Config version must be 1",
    });
  });

  it("reports invalid JSON through the unavailable state without throwing", async () => {
    await writeFile(join(dir, "scripts.json"), "{ not json", "utf8");
    await expect(loadGlobalTasksConfig(dir)).resolves.toMatchObject({
      kind: "unavailable",
      message: "Could not load global scripts.",
    });
  });
});
