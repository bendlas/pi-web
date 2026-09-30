import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PiWebPluginCatalog } from "../../src/server/piWebPluginCatalog.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("bundled Jujutsu package metadata", () => {
  it("declares a server-only, machine-neutral plugin entry", async () => {
    const metadata: unknown = JSON.parse(await readFile("pi-web-plugins/jj/package.json", "utf8"));

    expect(metadata).toMatchObject({
      private: true,
      type: "module",
      piWeb: { plugins: [{ id: "jj", serverModule: "server-plugin.js" }] },
    });
  });

  it("is discovered as one bundled server-only plugin that is enabled by default", async () => {
    const catalog = await jjCatalogFixture();

    const snapshot = await catalog.snapshot();
    const entry = snapshot.plugins[0];
    expect(entry).toMatchObject({
      id: "jj",
      source: "bundled",
      scope: "bundled",
      machineSpecific: false,
      enabled: true,
      serverModule: { path: "server-plugin.js" },
    });
    expect(entry?.browserModule).toBeUndefined();
    expect(snapshot.diagnostics).toEqual([]);
  });
});

async function jjCatalogFixture(): Promise<PiWebPluginCatalog> {
  const root = await mkdtemp(join(tmpdir(), "pi-web-jj-package-"));
  tempRoots.push(root);
  const pluginsRoot = join(root, "plugins");
  const pluginRoot = join(pluginsRoot, "jj");
  await mkdir(pluginRoot, { recursive: true });
  await Promise.all([
    writeFile(join(pluginRoot, "package.json"), await readFile("pi-web-plugins/jj/package.json", "utf8"), "utf8"),
    writeFile(join(pluginRoot, "server-plugin.js"), "export default {};\n", "utf8"),
  ]);
  return new PiWebPluginCatalog({
    roots: [{ path: pluginsRoot, source: "bundled", scope: "bundled" }],
    packageProvider: false,
    configProvider: () => ({}),
  });
}