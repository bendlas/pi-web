import type { TemplateResult } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo, SessionStatus } from "../api";
import { initialAppState, type AppState } from "../appState";
// Template inspection is proportionate here because this test verifies only the
// sibling-component callback/property wiring in a node environment without DOM.
import { templateValueAfterMarker } from "../templateInspection.testSupport";
import { PiWebApp } from "./PiWebApp";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PiWebApp session-warning visibility wiring", () => {
  it("keeps the warning control present and toggles the warning area from the status bar", () => {
    const app = createApp();
    const state = stateWithWarnings();
    setAppState(app, state);
    syncWarningVisibility(app);

    const visibleStatusBar = renderStatusBar(app, state);
    expect(templateValueAfterMarker(renderChatNotices(app, state), ".warningsVisible=")).toBe(true);
    expect(templateValueAfterMarker(visibleStatusBar, ".warningCount=")).toBe(2);
    expect(templateValueAfterMarker(visibleStatusBar, ".warningsExpanded=")).toBe(true);

    const toggle = templateCallbackAfterMarker(visibleStatusBar, ".onToggleWarnings=");
    toggle();

    const collapsedStatusBar = renderStatusBar(app, state);
    expect(templateValueAfterMarker(renderChatNotices(app, state), ".warningsVisible=")).toBe(false);
    expect(templateValueAfterMarker(collapsedStatusBar, ".warningCount=")).toBe(2);
    expect(templateValueAfterMarker(collapsedStatusBar, ".warningsExpanded=")).toBe(false);

    const otherState = stateWithWarnings("session-2");
    setAppState(app, otherState);
    syncWarningVisibility(app);
    expect(templateValueAfterMarker(renderChatNotices(app, otherState), ".warningsVisible=")).toBe(true);

    const returningState = { ...state, status: undefined };
    setAppState(app, returningState);
    syncWarningVisibility(app);
    expect(templateValueAfterMarker(renderChatNotices(app, returningState), ".warningsVisible=")).toBe(true);
    expect(templateValueAfterMarker(renderStatusBar(app, returningState), ".warningCount=")).toBe(0);

    setAppState(app, state);
    syncWarningVisibility(app);
    const returnedStatusBar = renderStatusBar(app, state);
    expect(templateValueAfterMarker(renderChatNotices(app, state), ".warningsVisible=")).toBe(false);
    expect(templateValueAfterMarker(returnedStatusBar, ".warningCount=")).toBe(2);
    expect(templateValueAfterMarker(returnedStatusBar, ".warningsExpanded=")).toBe(false);

    templateCallbackAfterMarker(returnedStatusBar, ".onToggleWarnings=")();

    const restoredStatusBar = renderStatusBar(app, state);
    expect(templateValueAfterMarker(renderChatNotices(app, state), ".warningsVisible=")).toBe(true);
    expect(templateValueAfterMarker(restoredStatusBar, ".warningCount=")).toBe(2);
    expect(templateValueAfterMarker(restoredStatusBar, ".warningsExpanded=")).toBe(true);
  });
});

type RenderChatNotices = (this: PiWebApp, state: AppState) => TemplateResult | null;
type RenderStatusBar = (this: PiWebApp, state: AppState) => TemplateResult;
type SyncWarningVisibility = (this: PiWebApp) => void;
type WarningVisibilityCallback = () => void;

function createApp(): PiWebApp {
  const storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  vi.stubGlobal("window", { location: { search: "" }, localStorage: storage });
  return new PiWebApp();
}

function stateWithWarnings(sessionId = "session-1"): AppState {
  const selectedSession: SessionInfo = {
    id: sessionId,
    cwd: "/repo",
    path: `/repo/${sessionId}.jsonl`,
    created: "2026-07-14T00:00:00.000Z",
    modified: "2026-07-14T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "hello",
  };
  return {
    ...initialAppState(),
    selectedSession,
    status: warningStatus(sessionId),
  };
}

function warningStatus(sessionId: string): SessionStatus {
  return {
    sessionId,
    isStreaming: true,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    warnings: [
      { severity: "warning", message: "subscription auth is active" },
      { severity: "error", message: "skill failed to load" },
    ],
  };
}

function setAppState(app: PiWebApp, state: AppState): void {
  if (!Reflect.set(app, "state", state)) throw new Error("Could not set PiWebApp state");
}

function syncWarningVisibility(app: PiWebApp): void {
  const method: unknown = Reflect.get(app, "syncSessionWarningVisibility");
  if (!isSyncWarningVisibility(method)) throw new Error("PiWebApp.syncSessionWarningVisibility is not callable");
  method.call(app);
}

function renderChatNotices(app: PiWebApp, state: AppState): TemplateResult {
  const method: unknown = Reflect.get(app, "renderChatNotices");
  if (!isRenderChatNotices(method)) throw new Error("PiWebApp.renderChatNotices is not callable");
  const rendered = method.call(app, state);
  if (rendered === null) throw new Error("Expected the top-bar notices");
  return rendered;
}

function renderStatusBar(app: PiWebApp, state: AppState): TemplateResult {
  const method: unknown = Reflect.get(app, "renderStatusBar");
  if (!isRenderStatusBar(method)) throw new Error("PiWebApp.renderStatusBar is not callable");
  return method.call(app, state);
}

function templateCallbackAfterMarker(template: TemplateResult, marker: string): WarningVisibilityCallback {
  const value = templateValueAfterMarker(template, marker);
  if (!isWarningVisibilityCallback(value)) throw new Error(`Expected callback after ${marker}`);
  return value;
}

function isRenderChatNotices(value: unknown): value is RenderChatNotices {
  return typeof value === "function";
}

function isRenderStatusBar(value: unknown): value is RenderStatusBar {
  return typeof value === "function";
}

function isSyncWarningVisibility(value: unknown): value is SyncWarningVisibility {
  return typeof value === "function";
}

function isWarningVisibilityCallback(value: unknown): value is WarningVisibilityCallback {
  return typeof value === "function";
}
