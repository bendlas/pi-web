import { afterEach, describe, expect, it, vi } from "vitest";
import { initialAppState, type AppState } from "../appState";
import type { SessionInfo, SessionStatus } from "../api";
import { templateText } from "../templateInspection.testSupport";
import { PiWebApp } from "./PiWebApp";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PiWebApp chat chrome auto-hide wiring", () => {
  function createApp(): PiWebApp {
    const storage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    vi.stubGlobal("window", { location: { search: "" }, localStorage: storage });
    const app = new PiWebApp();
    // The node test environment has no layout, so stub the one DOM call the
    // top-level render template makes while computing resizable panel widths.
    app.getBoundingClientRect = () => ({ width: 1200, height: 800, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
    return app;
  }

  function selectedSessionState(): AppState {
    const session: SessionInfo = {
      id: "session-1",
      cwd: "/repo",
      path: "/repo/session-1.jsonl",
      created: "2026-07-14T00:00:00.000Z",
      modified: "2026-07-14T00:00:00.000Z",
      messageCount: 1,
      firstMessage: "hello",
    };
    const status: SessionStatus = {
      sessionId: "session-1",
      isStreaming: false,
      isCompacting: false,
      isBashRunning: false,
      pendingMessageCount: 0,
      queuedMessages: [],
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost: 0,
    };
    return { ...initialAppState(), selectedSession: session, status };
  }

  function setAppState(app: PiWebApp, state: AppState): void {
    if (!Reflect.set(app, "state", state)) throw new Error("Could not set PiWebApp state");
  }

  function renderApp(app: PiWebApp): string {
    const render = Reflect.get(app, "render");
    if (typeof render !== "function") throw new Error("PiWebApp.render is not callable");
    return templateText(render.call(app));
  }

  function chromeHidden(app: PiWebApp): boolean {
    return Reflect.get(app, "chatChromeHidden") === true;
  }

  function emitChromeVisibility(app: PiWebApp, hidden: boolean): void {
    const handler = Reflect.get(app, "handleChatChromeVisibility");
    if (typeof handler !== "function") throw new Error("PiWebApp.handleChatChromeVisibility is not callable");
    handler.call(app, { detail: { hidden } } as CustomEvent<{ hidden: boolean }>);
  }

  it("slides the chrome out of the way when the chat reports a hide", () => {
    const app = createApp();
    setAppState(app, selectedSessionState());

    emitChromeVisibility(app, true);

    expect(chromeHidden(app)).toBe(true);
    expect(renderApp(app)).toContain("chrome-hidden");
  });

  it("brings the chrome back into view when the chat reports a reveal", () => {
    const app = createApp();
    setAppState(app, selectedSessionState());
    emitChromeVisibility(app, true);
    expect(chromeHidden(app)).toBe(true);

    emitChromeVisibility(app, false);

    expect(chromeHidden(app)).toBe(false);
    expect(renderApp(app)).not.toContain("chrome-hidden");
  });

  it("keeps the input area visible while the composer is focused", () => {
    const app = createApp();
    setAppState(app, selectedSessionState());
    const focusedEditor = { contains: () => true };
    Object.defineProperty(app, "promptEditor", { value: focusedEditor, configurable: true, writable: true });
    vi.stubGlobal("document", { activeElement: {} });

    emitChromeVisibility(app, true);

    expect(chromeHidden(app)).toBe(false);
    expect(renderApp(app)).not.toContain("chrome-hidden");
  });
});
