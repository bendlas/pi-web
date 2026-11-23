// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { SessionStatus } from "../api";
import type { ChatLine } from "./shared";
import { ChatView } from "./ChatView";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("ChatView disclosure persistence", () => {
  it("keeps a user-opened thinking block and its group open when the response finishes", async () => {
    const view = new ChatView();
    view.sessionId = "disclosure-finish";
    view.status = sessionStatus({ isStreaming: true });
    view.messages = [thinkingMessage("deep reasoning")];
    document.body.append(view);
    await render(view);

    const liveGroup = requiredElement(view.shadowRoot?.querySelector<HTMLDetailsElement>("details.event-group"), "live event group");
    expect(liveGroup.open).toBe(true);

    const thinking = requiredElement(view.shadowRoot?.querySelector<HTMLDetailsElement>("details.part"), "thinking disclosure");
    // The live block starts open, so model a user gesture that collapses and then
    // re-opens it.
    toggle(thinking, false);
    await render(view);
    toggle(thinking, true);
    await render(view);

    view.status = sessionStatus({ isStreaming: false });
    await render(view);

    const finishedGroup = requiredElement(view.shadowRoot?.querySelector<HTMLDetailsElement>("details.event-group"), "finished event group");
    expect(finishedGroup.open).toBe(true);
    expect(requiredElement(view.shadowRoot?.querySelector<HTMLDetailsElement>("details.part"), "thinking disclosure").open).toBe(true);
  });

  it("still closes an event group the user never opened when the response finishes", async () => {
    const view = new ChatView();
    view.sessionId = "disclosure-finish-untouched";
    view.status = sessionStatus({ isStreaming: true });
    view.messages = [thinkingMessage("unopened reasoning")];
    document.body.append(view);
    await render(view);

    view.status = sessionStatus({ isStreaming: false });
    await render(view);

    const finishedGroup = requiredElement(view.shadowRoot?.querySelector<HTMLDetailsElement>("details.event-group"), "finished event group");
    expect(finishedGroup.open).toBe(false);
  });

  it("stores nothing when a default-open block fires a toggle by itself", async () => {
    const view = new ChatView();
    view.sessionId = "disclosure-programmatic";
    view.status = sessionStatus({ isStreaming: true });
    view.messages = [thinkingMessage("unopened reasoning")];
    document.body.append(view);
    await render(view);

    const thinking = requiredElement(view.shadowRoot?.querySelector<HTMLDetailsElement>("details.part"), "thinking disclosure");
    expect(thinking.open).toBe(true);
    // Opening the block from the binding fires the same event a click would; it
    // must not read as the user asking for the block (and its group) to stay.
    thinking.dispatchEvent(new Event("toggle"));

    expect(localStorage.getItem("pi-web:chat-groups:disclosure-programmatic")).toBeNull();
  });
});

function thinkingMessage(text: string): ChatLine {
  return { role: "assistant", parts: [{ type: "thinking", text }] };
}

function sessionStatus(overrides: Partial<SessionStatus>): SessionStatus {
  return {
    sessionId: "disclosure-fixture",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    ...overrides,
  };
}

async function render(view: ChatView): Promise<void> {
  await view.updateComplete;
  await view.updateComplete;
}

function toggle(details: HTMLDetailsElement, open: boolean): void {
  details.open = open;
  details.dispatchEvent(new Event("toggle"));
}

function requiredElement<T extends Element>(element: T | null | undefined, label: string): T {
  if (element === null || element === undefined) throw new Error(`Expected ${label} to render`);
  return element;
}