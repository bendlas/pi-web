// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialAppState, type AppState } from "../appState";
import type { SessionInfo, SessionStatus } from "../api";
import { templateText } from "../templateInspection.testSupport";
import type { ChatChromeScrollDetail } from "./ChatView";
import { PiWebApp } from "./PiWebApp";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PiWebApp chat chrome scroll wiring", () => {
  function createApp(): PiWebApp {
    const app = new PiWebApp();
    // happy-dom has no layout, so stub the one DOM call the top-level render
    // template makes while computing resizable panel widths.
    app.getBoundingClientRect = () => ({ width: 1200, height: 800, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
    // The offset writer only touches the DOM for a connected element. Keep the app
    // detached (so no plugin lifecycle runs) and supply the two members it reads.
    const properties = new Map<string, string>();
    Object.defineProperty(app, "isConnected", { value: true, configurable: true });
    Object.defineProperty(app, "style", {
      configurable: true,
      value: {
        setProperty: (name: string, value: string): void => { properties.set(name, value); },
        getPropertyValue: (name: string): string => properties.get(name) ?? "",
      },
    });
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

  function emitChromeScroll(app: PiWebApp, detail: ChatChromeScrollDetail): void {
    callAppHandler(app, "handleChatChromeScroll", { detail });
  }

  function callAppHandler(app: PiWebApp, handlerName: string, event: unknown): void {
    const handler: unknown = Object.getOwnPropertyDescriptor(app, handlerName)?.value;
    if (typeof handler !== "function") throw new Error(`PiWebApp.${handlerName} is not callable`);
    handler.call(app, event);
  }

  function topOffset(app: PiWebApp): string {
    return app.style.getPropertyValue("--pi-chat-chrome-top-offset");
  }

  function bottomOffset(app: PiWebApp): string {
    return app.style.getPropertyValue("--pi-chat-chrome-bottom-offset");
  }

  it("accumulates the scroll distance into a chrome slide offset", () => {
    const app = createApp();
    setAppState(app, selectedSessionState());

    emitChromeScroll(app, { delta: 20, reveal: false });
    expect(topOffset(app)).toBe("20px");
    expect(bottomOffset(app)).toBe("20px");

    emitChromeScroll(app, { delta: 12, reveal: false });
    expect(topOffset(app)).toBe("32px");
    expect(bottomOffset(app)).toBe("32px");
  });

  it("clamps the slide offset to the fallback height", () => {
    const app = createApp();
    setAppState(app, selectedSessionState());

    emitChromeScroll(app, { delta: 500, reveal: false });

    expect(topOffset(app)).toBe("64px");
    expect(bottomOffset(app)).toBe("64px");
  });

  it("reveals the chrome again when the chat reports the live tail", () => {
    const app = createApp();
    setAppState(app, selectedSessionState());
    emitChromeScroll(app, { delta: 40, reveal: false });

    emitChromeScroll(app, { delta: 0, reveal: true });

    expect(topOffset(app)).toBe("0px");
    expect(bottomOffset(app)).toBe("0px");
  });

  it("keeps the input area visible once the composer is focused", () => {
    const app = createApp();
    setAppState(app, selectedSessionState());
    const focusedEditor = { contains: () => true };
    Object.defineProperty(app, "promptEditor", { value: focusedEditor, configurable: true, writable: true });
    callAppHandler(app, "handleChromeFocusIn", { target: document.createElement("span") });
    emitChromeScroll(app, { delta: 40, reveal: false });

    expect(topOffset(app)).toBe("0px");
    expect(bottomOffset(app)).toBe("0px");
  });

  it("renders no legacy collapse class", () => {
    const app = createApp();
    setAppState(app, selectedSessionState());

    expect(renderApp(app)).not.toContain("chrome-hidden");
  });
});
