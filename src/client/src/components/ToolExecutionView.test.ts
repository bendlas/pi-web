// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { summarizeArgs } from "../chatMessages";
import { ToolExecutionView } from "./ToolExecutionView";
import type { ToolExecutionPart } from "./shared";

afterEach(() => {
  document.body.replaceChildren();
});

function render(execution: ToolExecutionPart): ToolExecutionView {
  const view = new ToolExecutionView();
  view.execution = execution;
  document.body.append(view);
  return view;
}

const waitExecution: ToolExecutionPart = {
  type: "toolExecution",
  toolName: "tmux_wait",
  summary: "events: 1 item · timeout: 1800",
  args: { events: [{ target: "build:logs", when: "match", pattern: "BUILD SUCCESS" }], timeout: 1800 },
  status: "running",
};

it("renders every argument, including a nested tmux match pattern, expanded by default", async () => {
  const view = render(waitExecution);
  await view.updateComplete;

  const args = view.renderRoot.querySelector<HTMLDetailsElement>("details.arguments");
  expect(args).not.toBeNull();
  expect(args?.open).toBe(true);
  expect(args?.textContent).toContain("BUILD SUCCESS");
  expect(args?.textContent).toContain("build:logs");
});

it("keeps arguments available but collapsed when a diff is the primary view", async () => {
  const view = render({ ...waitExecution, preview: { diff: "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new" } });
  await view.updateComplete;

  const args = view.renderRoot.querySelector<HTMLDetailsElement>("details.arguments");
  expect(args).not.toBeNull();
  expect(args?.open).toBe(false);
  expect(args?.textContent).toContain("BUILD SUCCESS");
});

it("omits the arguments section when the tool received no arguments", async () => {
  const view = render({ type: "toolExecution", toolName: "noop", summary: "", args: {}, status: "success" });
  await view.updateComplete;
  expect(view.renderRoot.querySelector("details.arguments")).toBeNull();
});

it("summarizes nested argument values instead of collapsing them to a count", () => {
  const summary = summarizeArgs(waitExecution.args);
  expect(summary).toContain("build:logs");
  expect(summary).toContain("BUILD SUCCESS");
  expect(summary).toContain("timeout: 1800");
});
