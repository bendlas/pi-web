// @vitest-environment happy-dom

import { generate, parse, walk } from "css-tree";
import { html, render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { WorkspacePanelContext } from "@jmfederico/pi-web/plugin-api";
import { renderTasksPanel } from "./tasksPanel.js";

const missing = () => Promise.reject(new Error("not found"));

function panelContext(): WorkspacePanelContext {
  return {
    navigate: () => Promise.resolve(),
    machine: { id: "local", name: "local", kind: "local" },
    workspace: { id: "workspace-1", projectId: "project-1", path: "/repo", label: "main", isMain: true },
    files: {
      readFile: missing,
      listFiles: missing,
      writeFile: missing,
      deleteFile: missing,
      moveFile: missing,
    },
    terminal: { open: vi.fn(), runCommand: vi.fn(() => Promise.reject(new Error("not available"))) },
    host: { requestRender: vi.fn() },
    prompt: { insertText: vi.fn(), getText: () => "", getSelection: () => null },
  };
}

/** Renders the panel and returns the inline stylesheet it contributes to the host tree. */
function panelStyles(): string {
  const container = document.createElement("div");
  render(renderTasksPanel(html, panelContext()), container);
  return container.querySelector("style")?.textContent ?? "";
}

function selectors(css: string): string[] {
  const found: string[] = [];
  walk(parse(css), (node) => {
    if (node.type === "Rule") found.push(generate(node.prelude));
  });
  return found.flatMap((list) => list.split(",").map((selector) => selector.trim()));
}

function hasClassSelector(selector: string): boolean {
  let found = false;
  walk(parse(selector, { context: "selector" }), (node) => {
    if (node.type === "ClassSelector") found = true;
  });
  return found;
}

describe("agent tasks panel styles", () => {
  // The stylesheet is inserted into the host's panel container, next to the workspace tab
  // strip. Host chrome styles sit in `@layer pi-web-base`, so an unlayered element selector
  // here (such as a bare `button`) would win the cascade and restyle the tabs themselves.
  it("scopes every selector to a class so it cannot restyle host chrome", () => {
    const css = panelStyles();
    expect(css).not.toBe("");
    const unscoped = selectors(css).filter((selector) => !hasClassSelector(selector));
    expect(unscoped).toEqual([]);
  });

  it("gives its own controls a panel class instead of styling bare elements", () => {
    const css = panelStyles();
    expect(selectors(css)).toContain(".tasks-action");
    expect(selectors(css)).toContain(".tasks-toolbar");
  });
});
