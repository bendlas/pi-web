// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { summarizeArgs } from "../chatMessages";
import { ChatDisclosureController, type ChatDisclosureSnapshot, type ChatDisclosureStorage } from "../chatDisclosure";
import { ToolExecutionView } from "./ToolExecutionView";
import type { ToolExecutionPart } from "../chatTypes";
import { writeClipboardText } from "../clipboard";

vi.mock("../clipboard", () => ({ writeClipboardText: vi.fn(() => Promise.resolve(true)) }));

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
});

it("keeps command details and complete output while updating live status and errors", async () => {
  const view = new ToolExecutionView();
  const command = "printf 'long output'";
  view.execution = { type: "toolExecution", toolName: "bash", summary: command, args: { command }, status: "running" };
  document.body.append(view);
  await view.updateComplete;
  expect(view.renderRoot.querySelector(".status-label")?.textContent).toBe("running");
  const details = view.renderRoot.querySelector<HTMLDetailsElement>(".text-body");
  expect(details?.open).toBe(false);
  expect(view.renderRoot.querySelector(".detail-target-value")).toBeNull();

  const output = "long line ".repeat(1000);
  view.execution = { ...view.execution, status: "success", resultText: output };
  await view.updateComplete;
  expect(view.renderRoot.querySelector(".status-label")?.textContent).toBe("done");
  expect(view.renderRoot.querySelector(".detail-result")).toBeNull();
  expect(details?.open).toBe(false);
  if (details === null) throw new Error("Expected text disclosure");
  details.open = true; details.dispatchEvent(new Event("toggle"));
  await view.updateComplete;
  expect(view.renderRoot.querySelector(".detail-target-value")?.textContent).toBe(command);
  expect(view.renderRoot.querySelector(".detail-result pre")?.textContent).toBe(output);
  details.open = false; details.dispatchEvent(new Event("toggle"));
  await view.updateComplete;
  expect(view.renderRoot.querySelector(".detail-result")).toBeNull();

  view.execution = { ...view.execution, status: "error", resultText: "Command failed" };
  await view.updateComplete;
  expect(view.renderRoot.querySelector(".status-label")?.textContent).toBe("failed");
  expect(view.renderRoot.querySelector(".error-text")?.textContent).toBe("Command failed");
  expect(details.open).toBe(true);
});

it("retains diff disclosure state, expands long diffs, and copies the full diff", async () => {
  vi.useFakeTimers();
  const view = new ToolExecutionView();
  const diff = Array.from({ length: 200 }, (_, index) => `+line ${String(index)}`).join("\n");
  view.execution = { type: "toolExecution", toolName: "edit", summary: "file.ts", args: { path: "file.ts" }, status: "running", preview: { diff } };
  document.body.append(view);
  await view.updateComplete;
  const details = view.renderRoot.querySelector<HTMLDetailsElement>(".diff-details");
  expect(details?.open).toBe(true);
  expect(view.renderRoot.querySelectorAll(".diff-content > span")).toHaveLength(180);
  if (details === null) throw new Error("Expected diff disclosure");
  details.open = false;
  details.dispatchEvent(new Event("toggle"));
  await view.updateComplete;
  expect(view.renderRoot.querySelector(".diff, .diff-toolbar, .detail-target")).toBeNull();
  const split = vi.spyOn(String.prototype, "split");
  view.execution = { ...view.execution, status: "success", details: { diff } };
  await view.updateComplete;
  expect(details.open).toBe(false);
  expect(view.renderRoot.querySelector(".diff")).toBeNull();
  // The unchanged diff needs neither another statistics scan nor line rendering.
  expect(split.mock.contexts.filter((value) => String(value) === diff)).toHaveLength(0);
  split.mockRestore();
  details.open = true;
  details.dispatchEvent(new Event("toggle"));
  await view.updateComplete;

  view.renderRoot.querySelector<HTMLButtonElement>(".show-more")?.click();
  await view.updateComplete;
  expect(view.renderRoot.querySelectorAll(".diff-content > span")).toHaveLength(200);
  expect(view.renderRoot.querySelector(".show-more")).toBeNull();
  const copy = view.renderRoot.querySelector<HTMLButtonElement>(".diff-toolbar button");
  copy?.click();
  await vi.advanceTimersByTimeAsync(0);
  await view.updateComplete;
  expect(writeClipboardText).toHaveBeenCalledWith(diff);
  expect(copy?.textContent).toBe("Copied");
  await vi.advanceTimersByTimeAsync(1200);
  await view.updateComplete;
  expect(copy?.textContent).toBe("Copy diff");
});

function toggle(details: HTMLDetailsElement, open: boolean): void {
  details.open = open;
  details.dispatchEvent(new Event("toggle"));
}

function requiredElement<T extends Element>(element: T | null | undefined, label: string): T {
  if (element === null || element === undefined) throw new Error(`Expected ${label} to render`);
  return element;
}

function renderExecution(execution: ToolExecutionPart): ToolExecutionView {
  const view = new ToolExecutionView();
  view.execution = execution;
  document.body.append(view);
  return view;
}

const waitExecution: ToolExecutionPart = {
  type: "toolExecution",
  toolName: "tmux_wait",
  summary: "events: 1 item \u00b7 timeout: 1800",
  args: { events: [{ target: "build:logs", when: "match", pattern: "BUILD SUCCESS" }], timeout: 1800 },
  status: "running",
};

it("keeps tool arguments collapsed and unbuilt until they are opened", async () => {
  const view = renderExecution(waitExecution);
  await view.updateComplete;

  const args = requiredElement(view.renderRoot.querySelector<HTMLDetailsElement>("details.arguments"), "arguments disclosure");
  expect(args.open).toBe(false);
  expect(args.textContent).toMatch(/\d+ lines/);
  // A long session renders one of these per tool call, so the JSON body only
  // exists while a reader asked for it.
  expect(view.renderRoot.querySelector(".arguments-json")).toBeNull();

  toggle(args, true);
  await view.updateComplete;

  expect(args.open).toBe(true);
  const body = requiredElement(view.renderRoot.querySelector(".arguments-json"), "argument body");
  expect(body.textContent).toContain("BUILD SUCCESS");
  expect(body.textContent).toContain("build:logs");

  toggle(args, false);
  await view.updateComplete;
  expect(view.renderRoot.querySelector(".arguments-json")).toBeNull();
});

it("keeps arguments collapsed alongside a diff and opens them on demand", async () => {
  const view = renderExecution({ ...waitExecution, preview: { diff: "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new" } });
  await view.updateComplete;

  const args = requiredElement(view.renderRoot.querySelector<HTMLDetailsElement>("details.arguments"), "arguments disclosure");
  expect(args.open).toBe(false);
  expect(view.renderRoot.querySelector(".arguments-json")).toBeNull();

  toggle(args, true);
  await view.updateComplete;
  expect(requiredElement(view.renderRoot.querySelector(".arguments-json"), "argument body").textContent).toContain("BUILD SUCCESS");
});

it("omits the arguments section when the tool received no arguments", async () => {
  const view = renderExecution({ type: "toolExecution", toolName: "noop", summary: "", args: {}, status: "success" });
  await view.updateComplete;
  expect(view.renderRoot.querySelector("details.arguments")).toBeNull();
});

it("summarizes nested argument values instead of collapsing them to a count", () => {
  const summary = summarizeArgs(waitExecution.args);
  expect(summary).toContain("build:logs");
  expect(summary).toContain("BUILD SUCCESS");
  expect(summary).toContain("timeout: 1800");
});

describe("ToolExecutionView disclosure persistence", () => {
  it("restores a user-opened details disclosure after the tool view is recreated", async () => {
    const controller = new ChatDisclosureController(new MemoryDisclosureStorage());
    controller.syncSession("session-1");
    const execution: ToolExecutionPart = {
      type: "toolExecution",
      toolName: "read",
      summary: "src/file.ts",
      status: "success",
      resultText: "file contents",
    };

    const first = mount(execution, controller);
    await settled(first);
    const firstDetails = requiredElement(first.shadowRoot?.querySelector<HTMLDetailsElement>("details.text-body"), "details disclosure");
    expect(firstDetails.open).toBe(false);
    toggle(firstDetails, true);
    await settled(first);

    expect(controller.isOpen("part-1:text", false)).toBe(true);
    expect(controller.isOpen("group-1", false)).toBe(true);

    // Re-mounting models the surrounding group body rendering the tool again.
    const second = mount(execution, controller);
    await settled(second);
    expect(requiredElement(second.shadowRoot?.querySelector<HTMLDetailsElement>("details.text-body"), "details disclosure").open).toBe(true);
  });

  it("does not record a disclosure the render opened by itself", async () => {
    const controller = new ChatDisclosureController(new MemoryDisclosureStorage());
    controller.syncSession("session-1");
    const execution: ToolExecutionPart = {
      type: "toolExecution",
      toolName: "bash",
      summary: "false",
      args: { command: "false" },
      status: "running",
      resultText: "exit 1",
    };

    const view = mount(execution, controller);
    await settled(view);
    const details = requiredElement(view.shadowRoot?.querySelector<HTMLDetailsElement>("details.text-body"), "details disclosure");
    expect(details.open).toBe(false);

    // A failed tool opens its output by default, and that write fires the same
    // toggle event a click does.
    view.execution = { ...execution, status: "error" };
    await settled(view);
    expect(details.open).toBe(true);
    details.dispatchEvent(new Event("toggle"));

    expect(controller.snapshot()).toEqual({ open: [], closedDefaultOpen: [] });
  });
});

class MemoryDisclosureStorage implements ChatDisclosureStorage {
  private readonly snapshots = new Map<string, ChatDisclosureSnapshot>();

  read(sessionId: string): ChatDisclosureSnapshot | undefined {
    const snapshot = this.snapshots.get(sessionId);
    return snapshot === undefined ? undefined : { open: [...snapshot.open], closedDefaultOpen: [...snapshot.closedDefaultOpen] };
  }

  write(sessionId: string, snapshot: ChatDisclosureSnapshot): void {
    this.snapshots.set(sessionId, { open: [...snapshot.open], closedDefaultOpen: [...snapshot.closedDefaultOpen] });
  }
}

function mount(execution: ToolExecutionPart, controller: ChatDisclosureController): ToolExecutionView {
  const view = new ToolExecutionView();
  view.execution = execution;
  view.disclosures = controller;
  view.disclosureKey = "part-1";
  view.groupDisclosureKey = "group-1";
  document.body.append(view);
  return view;
}

async function settled(view: ToolExecutionView): Promise<void> {
  await view.updateComplete;
  await view.updateComplete;
}
