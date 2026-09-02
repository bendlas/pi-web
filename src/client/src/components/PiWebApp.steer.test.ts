// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { PiWebApp } from "./PiWebApp";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("PiWebApp composer steer shortcut", () => {
  it("sends the current draft as a steer and clears the composer input", () => {
    const app = new PiWebApp();
    // Stub the CodeMirror-backed editor with a fixed draft.
    const clearComposer = vi.fn();
    Object.defineProperty(app, "promptEditor", {
      configurable: true,
      value: { view: { state: { doc: { toString: () => "steer this" } } }, clearComposer },
    });
    // Capture the underlying send path call.
    const sendPrompt = vi.fn();
    Object.defineProperty(app, "sendPrompt", { configurable: true, value: sendPrompt });

    const steer: unknown = Reflect.get(app, "steerCurrentPrompt");
    if (typeof steer !== "function") throw new Error("steerCurrentPrompt was unavailable");
    Reflect.apply(steer, app, []);

    expect(sendPrompt).toHaveBeenCalledOnce();
    expect(sendPrompt).toHaveBeenCalledWith("steer this", "steer", undefined, undefined);
    // Steering must clear the input exactly like a normal send does.
    expect(clearComposer).toHaveBeenCalledOnce();
  });
});
