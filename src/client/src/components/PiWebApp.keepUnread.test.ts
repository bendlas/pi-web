import type { TemplateResult } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project, SessionInfo, SessionUnreadEvent, SessionUnreadSummary, Workspace } from "../api";
import { initialAppState, type AppState } from "../appState";
import { loadKeepUnreadIds } from "../keepUnreadSessions";
import type { BrowserRealtimeEvent } from "../sessionSocket";
// Template inspection is proportionate here because this node-environment test
// verifies only PiWebApp's keep-unread property/callback wiring into navigation.
import { templateValueAfterMarker } from "../templateInspection.testSupport";
import { PiWebApp } from "./PiWebApp";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PiWebApp keep-conversation-unread", () => {
  it("keeps a pinned conversation unread while it is read, and acknowledges it once unpinned", async () => {
    const fetchMock = stubJsonFetch({ catalogId: "catalog-a", catalogRevision: 2, sessions: [] });
    const app = createApp();
    enableUnread(app);
    const selected = session("selected");
    setAppState(app, { ...initialAppState(), sessions: [selected], selectedSession: selected, mainView: "chat" });
    exposeSelectedChat(app);

    navigationToggleKeepUnread(app)(selected);
    expect([...navigationKeepUnreadSessionIds(app)]).toEqual([selected.id]);

    // A server completion for the conversation the user is looking at would
    // normally be acknowledged on the next committed render.
    handleRealtimeEvent(app, unreadEvent(1, unreadSummary(selected, 1)));
    invokeUpdated(app);
    await flushMicrotasks();

    expect(fetchMock).not.toHaveBeenCalled();
    expect([...navigationUnreadSessionIds(app)]).toEqual([selected.id]);

    navigationToggleKeepUnread(app)(selected);
    expect([...navigationKeepUnreadSessionIds(app)]).toEqual([]);
    await vi.waitFor(() => { expect(fetchMock).toHaveBeenCalledOnce(); });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://pi.example.test/api/machines/local/sessions/selected/unread/acknowledge");
    await vi.waitFor(() => { expect(navigationUnreadSessionIds(app).size).toBe(0); });
  });

  it("shows the union of server unread and pinned conversations", () => {
    stubJsonFetch({ catalogId: "catalog-a", catalogRevision: 2, sessions: [] });
    const app = createApp();
    enableUnread(app);
    const foreground = session("foreground");
    const background = session("background");
    const pinned = session("pinned");
    setAppState(app, { ...initialAppState(), sessions: [foreground, background, pinned], selectedSession: foreground, mainView: "chat" });
    exposeSelectedChat(app);

    handleRealtimeEvent(app, unreadEvent(1, unreadSummary(background, 1)));
    expect([...navigationUnreadSessionIds(app)]).toEqual([background.id]);

    // A conversation with no server completion is shown unread purely because
    // the user pinned it.
    navigationToggleKeepUnread(app)(pinned);
    expect([...navigationUnreadSessionIds(app)].sort()).toEqual([background.id, pinned.id]);
    expect([...navigationKeepUnreadSessionIds(app)]).toEqual([pinned.id]);
  });

  it("clears the pin when the conversation is explicitly marked as read", async () => {
    const fetchMock = stubJsonFetch({ catalogId: "catalog-a", catalogRevision: 2, sessions: [] });
    const app = createApp();
    enableUnread(app);
    const selected = session("selected");
    const alpha = session("alpha");
    setAppState(app, { ...initialAppState(), sessions: [selected, alpha], selectedSession: selected, mainView: "chat" });
    exposeSelectedChat(app);

    handleRealtimeEvent(app, unreadEvent(1, unreadSummary(alpha, 1)));
    navigationToggleKeepUnread(app)(alpha);
    expect([...navigationUnreadSessionIds(app)]).toEqual([alpha.id]);

    navigationMarkSessionRead(app)(alpha);

    expect([...navigationKeepUnreadSessionIds(app)]).toEqual([]);
    expect([...loadKeepUnreadIds("local")]).toEqual([]);
    await vi.waitFor(() => { expect(fetchMock).toHaveBeenCalledOnce(); });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://pi.example.test/api/machines/local/sessions/alpha/unread/acknowledge");
    await vi.waitFor(() => { expect(navigationUnreadSessionIds(app).size).toBe(0); });
  });

  it("restores pinned conversations after a reload and forgets them once unpinned", () => {
    stubJsonFetch({ catalogId: "catalog-a", catalogRevision: 2, sessions: [] });
    const storedValues = new Map<string, string>();
    const pinned = session("pinned");
    const appState = (): AppState => ({ ...initialAppState(), sessions: [pinned], mainView: "chat" });

    const before = createApp({ storedValues });
    setAppState(before, appState());
    navigationToggleKeepUnread(before)(pinned);
    expect([...navigationKeepUnreadSessionIds(before)]).toEqual([pinned.id]);

    const reloaded = createApp({ storedValues });
    setAppState(reloaded, appState());
    expect([...navigationKeepUnreadSessionIds(reloaded)]).toEqual([pinned.id]);
    expect([...navigationUnreadSessionIds(reloaded)]).toEqual([pinned.id]);

    navigationToggleKeepUnread(reloaded)(pinned);
    expect([...navigationKeepUnreadSessionIds(reloaded)]).toEqual([]);
    expect([...navigationUnreadSessionIds(reloaded)]).toEqual([]);

    const reloadedAgain = createApp({ storedValues });
    setAppState(reloadedAgain, appState());
    expect([...navigationKeepUnreadSessionIds(reloadedAgain)]).toEqual([]);
  });

  it("drops a keep-unread pin once its workspace is removed, so the project badge goes dark", () => {
    stubJsonFetch({ catalogId: "catalog-a", catalogRevision: 2, sessions: [] });
    const app = createApp();
    enableUnread(app);
    const pinned = session("pinned");
    const workspace: Workspace = { id: "ws-1", projectId: "proj-1", path: "/repo", label: "ws", isMain: false, effectiveConfig: {} };
    const project: Project = { id: "proj-1", name: "proj", path: "/repo", createdAt: "2026-07-20T00:00:00.000Z" };
    setAppState(app, {
      ...initialAppState(),
      sessions: [pinned],
      selectedSession: pinned,
      selectedWorkspace: workspace,
      workspacesByProjectId: { "proj-1": [workspace] },
      projects: [project],
      mainView: "chat",
    });
    exposeSelectedChat(app);

    navigationToggleKeepUnread(app)(pinned);
    expect([...navigationKeepUnreadSessionIds(app)]).toEqual(["pinned"]);

    // The workspace (and so its sessions) is removed from the topology.
    setAppState(app, { ...initialAppState(), workspacesByProjectId: {}, projects: [], sessions: [] });
    const reconcile: unknown = Reflect.get(app, "reconcileKeepUnread");
    if (!isReconcileKeepUnread(reconcile)) throw new Error("Expected PiWebApp.reconcileKeepUnread to be callable");
    reconcile.call(app, new Set<string>());

    expect([...navigationKeepUnreadSessionIds(app)]).toEqual([]);
    expect([...loadKeepUnreadIds("local")]).toEqual([]);
  });
});

type RenderNavigationPanel = (this: PiWebApp) => TemplateResult;
type HandleRealtimeEvent = (this: PiWebApp, machineId: string, event: BrowserRealtimeEvent) => void;
type UpdatedHook = (this: PiWebApp) => void;
type SessionCallback = (session: SessionInfo) => void;
type ReconcileKeepUnread = (deletedSessionIds: ReadonlySet<string>) => void;

function isReconcileKeepUnread(value: unknown): value is ReconcileKeepUnread {
  return typeof value === "function";
}

function createApp(options: { storedValues?: Map<string, string> } = {}): PiWebApp {
  const values = options.storedValues ?? new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  vi.stubGlobal("window", {
    location: { search: "" },
    localStorage: storage,
    matchMedia: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    clearInterval: () => undefined,
    clearTimeout: () => undefined,
  });
  // The keep-unread store reads the bare browser storage global, exactly as the
  // other browser-local stores do.
  vi.stubGlobal("localStorage", storage);
  if (typeof document === "undefined") {
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/", visibilityState: "visible", hasFocus: () => true });
  }
  vi.stubGlobal("requestAnimationFrame", () => 1);
  return new PiWebApp();
}

function setAppState(app: PiWebApp, state: AppState): void {
  if (!Reflect.set(app, "state", state)) throw new Error("Could not set PiWebApp state");
}

function handleRealtimeEvent(app: PiWebApp, event: BrowserRealtimeEvent): void {
  const method: unknown = Reflect.get(app, "handleRealtimeEvent");
  if (!isHandleRealtimeEvent(method)) throw new Error("PiWebApp.handleRealtimeEvent is not callable");
  method.call(app, "local", event);
}

function enableUnread(app: PiWebApp): void {
  if (!Reflect.set(app, "unreadConnected", true)) throw new Error("Could not connect PiWebApp unread state");
}

function exposeSelectedChat(app: PiWebApp): void {
  const state: unknown = Reflect.get(app, "state");
  if (typeof state !== "object" || state === null) throw new Error("PiWebApp state is unavailable");
  const selectedSession: unknown = Reflect.get(state, "selectedSession");
  if (typeof selectedSession !== "object" || selectedSession === null) throw new Error("Expected a selected chat");
  const sessionId: unknown = Reflect.get(selectedSession, "id");
  const cwd: unknown = Reflect.get(selectedSession, "cwd");
  if (typeof sessionId !== "string" || typeof cwd !== "string") throw new Error("Selected chat identity is invalid");
  if (!Reflect.set(app, "readyChatIdentity", JSON.stringify(["local", sessionId, cwd]))) {
    throw new Error("Could not mark selected chat ready");
  }
  invokeUpdated(app);
}

function invokeUpdated(app: PiWebApp): void {
  const method: unknown = Reflect.get(app, "updated");
  if (!isUpdatedHook(method)) throw new Error("PiWebApp.updated is not callable");
  method.call(app);
}

function navigationUnreadSessionIds(app: PiWebApp): ReadonlySet<string> {
  return navigationSessionIds(app, ".unreadSessionIds=");
}

function navigationKeepUnreadSessionIds(app: PiWebApp): ReadonlySet<string> {
  return navigationSessionIds(app, ".keepUnreadSessionIds=");
}

function navigationSessionIds(app: PiWebApp, marker: string): ReadonlySet<string> {
  const value = navigationPanelValue(app, marker);
  if (!(value instanceof Set) || ![...value].every((entry: unknown) => typeof entry === "string")) {
    throw new Error(`Expected session ids for ${marker} in navigation`);
  }
  return value;
}

function navigationToggleKeepUnread(app: PiWebApp): SessionCallback {
  const value = navigationPanelValue(app, ".onToggleKeepUnread=");
  if (!isSessionCallback(value)) throw new Error("Expected keep-unread toggle callback in navigation");
  return value;
}

function navigationMarkSessionRead(app: PiWebApp): SessionCallback {
  const value = navigationPanelValue(app, ".onMarkSessionRead=");
  if (!isSessionCallback(value)) throw new Error("Expected mark-session-read callback in navigation");
  return value;
}

function navigationPanelValue(app: PiWebApp, marker: string): unknown {
  const method: unknown = Reflect.get(app, "renderNavigationPanel");
  if (!isRenderNavigationPanel(method)) throw new Error("PiWebApp.renderNavigationPanel is not callable");
  return templateValueAfterMarker(method.call(app), marker);
}

function session(id: string): SessionInfo {
  return {
    id,
    cwd: "/repo",
    path: `/repo/${id}.jsonl`,
    created: "2026-07-20T00:00:00.000Z",
    modified: "2026-07-20T00:00:00.000Z",
    messageCount: 1,
    firstMessage: id,
  };
}

function unreadSummary(target: SessionInfo, completionOrder: number): SessionUnreadSummary {
  return {
    sessionId: target.id,
    cwd: target.cwd,
    completionOrder,
    completedAt: `2026-07-20T00:00:0${String(completionOrder)}.000Z`,
  };
}

function unreadEvent(catalogRevision: number, unread: SessionUnreadSummary): SessionUnreadEvent {
  return {
    type: "sessions.unread",
    catalogId: "catalog-a",
    catalogRevision,
    sessionId: unread.sessionId,
    cwd: unread.cwd,
    unread,
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function stubJsonFetch(body: unknown) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    void input;
    void init;
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function isRenderNavigationPanel(value: unknown): value is RenderNavigationPanel {
  return typeof value === "function";
}

function isHandleRealtimeEvent(value: unknown): value is HandleRealtimeEvent {
  return typeof value === "function";
}

function isUpdatedHook(value: unknown): value is UpdatedHook {
  return typeof value === "function";
}

function isSessionCallback(value: unknown): value is SessionCallback {
  return typeof value === "function";
}
