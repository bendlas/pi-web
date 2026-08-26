/**
 * Browser-local "keep this conversation unread" overrides.
 *
 * Unread itself is daemon-owned: reading a conversation clears it. This store
 * holds the opposite user intent — "leave the marker on even though I looked at
 * it" — which is a per-browser reminder rather than shared session state, so it
 * lives in `localStorage` keyed by machine and session id.
 *
 * Each pin also records the session's working directory and the workspace and
 * project that own it. The navigation must keep the unread marker on a
 * workspace/project/machine badge even when that workspace or project is not the
 * one currently open, so the roll-up cannot rely on the client's selected-
 * scoped session and workspace lists — it attributes the pin directly from the
 * ownership captured here at pin time.
 */

const storageKey = "pi-web.keep-unread.v1";
const EMPTY_SESSION_IDS: ReadonlySet<string> = new Set();

/** A pinned "keep unread" session with the ownership needed to light its tree. */
export interface KeepUnreadEntry {
  id: string;
  cwd: string;
  workspaceId: string;
  projectId: string;
}

type StoredKeepUnread = Record<string, KeepUnreadEntry[]>;

function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** Sessions the user pinned as unread on `machineId`, as a bare id set. */
export function loadKeepUnreadIds(machineId: string, storage = browserStorage()): ReadonlySet<string> {
  const entries = loadStored(storage)[machineId];
  return entries === undefined || entries.length === 0 ? EMPTY_SESSION_IDS : new Set(entries.map((entry) => entry.id));
}

/** Full pin records for `machineId`, carrying ownership for the nav roll-up. */
export function loadKeepUnreadEntries(machineId: string, storage = browserStorage()): readonly KeepUnreadEntry[] {
  return loadStored(storage)[machineId] ?? [];
}

/**
 * Pin or unpin one session. Unpinning removes the record (and the machine entry
 * once it is empty) so a stale override can never resurrect a read marker.
 */
export function setKeepUnread(machineId: string, entry: KeepUnreadEntry, keep: boolean, storage = browserStorage()): void {
  const stored = loadStored(storage);
  const current = stored[machineId] ?? [];
  const next = keep
    ? [...current.filter((candidate) => candidate.id !== entry.id), entry]
    : current.filter((candidate) => candidate.id !== entry.id);
  if (next.length === current.length && next.every((candidate, index) => candidate.id === current[index]?.id)) return;
  const entries: StoredKeepUnread = Object.fromEntries(Object.entries(stored).filter(([id]) => id !== machineId));
  if (next.length > 0) entries[machineId] = next;
  saveStored(entries, storage);
}

/**
 * What the client knows about the current topology, used to drop pins that can
 * no longer justify a marker.
 *
 * - `liveWorkspaceIds`: every workspace id the client currently tracks. A pin
 *   whose `workspaceId` is missing here points at a removed workspace, so the
 *   session it pins is gone and the pin must not keep lighting its project.
 * - `selectedWorkspaceId` / `selectedWorkspaceSessionIds` / `selectedWorkspaceArchivedIds`:
 *   the workspace the client is currently looking at and the sessions (including
 *   archived ones) it lists there. A pin attributed to the selected workspace is
 *   orphaned when its session was archived (it can never show a row marker) or
 *   has vanished from the list entirely — both leave the parent badges lit with
 *   no visible session carrying the marker. Pins for *other* (unloaded)
 *   workspaces are left alone, because the client cannot see their sessions and
 *   the keep-unread feature is meant to light badges across workspaces.
 * - `deletedSessionIds`: session ids the user explicitly deleted in this pass.
 *   Unlike the workspace/list sets, this is authoritative: a deleted session is
 *   gone everywhere, so any pin for it is an orphan regardless of workspace.
 */
export interface KeepUnreadReconcileContext {
  liveWorkspaceIds: ReadonlySet<string>;
  selectedWorkspaceId: string;
  selectedWorkspaceSessionIds: ReadonlySet<string>;
  selectedWorkspaceArchivedIds: ReadonlySet<string>;
  deletedSessionIds: ReadonlySet<string>;
}

/**
 * Drop keep-unread pins whose referenced session or workspace no longer exists.
 *
 * The daemon already sweeps its own unread catalog for vanished cwds/sessions,
 * but keep-unread pins are browser-local and were never reconciled, so a pinned
 * session that gets archived or deleted (or whose workspace is removed) kept its
 * project/workspace/machine badge lit forever — the exact stale-marker condition
 * the daemon fix had eliminated for daemon-owned unread.
 *
 * A pin is orphaned when:
 * - its `workspaceId` is set but no longer tracked (the workspace was removed),
 * - its `id` was explicitly deleted, or
 * - it is attributed to the *selected* workspace and its session was archived
 *   (it can never show a row marker) or has vanished from that workspace's list.
 *
 * Pins for other (unloaded) workspaces survive, because the client cannot see
 * their sessions and the keep-unread feature intentionally lights badges across
 * workspaces; visiting that workspace later reconciles them. Legacy id-only pins
 * (`workspaceId`/`projectId` empty) survive unless their `id` was deleted,
 * because they carry no workspace to invalidate against and only ever affect
 * the session row, never the parent badges.
 */
export function reconcileKeepUnreadEntries(
  entries: readonly KeepUnreadEntry[],
  context: KeepUnreadReconcileContext,
): KeepUnreadEntry[] {
  const {
    liveWorkspaceIds,
    selectedWorkspaceId,
    selectedWorkspaceSessionIds,
    selectedWorkspaceArchivedIds,
    deletedSessionIds,
  } = context;
  return entries.filter((entry) => {
    if (entry.workspaceId !== "" && !liveWorkspaceIds.has(entry.workspaceId)) return false;
    if (deletedSessionIds.has(entry.id)) return false;
    if (entry.workspaceId !== "" && entry.workspaceId === selectedWorkspaceId) {
      if (selectedWorkspaceArchivedIds.has(entry.id)) return false;
      if (selectedWorkspaceSessionIds.size > 0 && !selectedWorkspaceSessionIds.has(entry.id)) return false;
    }
    return true;
  });
}

function normalizeEntry(value: unknown): KeepUnreadEntry | undefined {
  if (typeof value === "string") return { id: value, cwd: "", workspaceId: "", projectId: "" };
  if (!isPlainRecord(value)) return undefined;
  const id = value["id"];
  if (typeof id !== "string") return undefined;
  return {
    id,
    cwd: typeof value["cwd"] === "string" ? value["cwd"] : "",
    workspaceId: typeof value["workspaceId"] === "string" ? value["workspaceId"] : "",
    projectId: typeof value["projectId"] === "string" ? value["projectId"] : "",
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadStored(storage: Storage | undefined): StoredKeepUnread {
  try {
    const raw = storage?.getItem(storageKey);
    if (raw === undefined || raw === null || raw === "") return {};
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    const entries: StoredKeepUnread = {};
    for (const [machineId, rawList] of Object.entries(value)) {
      if (!Array.isArray(rawList)) continue;
      const list = rawList.map(normalizeEntry).filter((entry): entry is KeepUnreadEntry => entry !== undefined);
      if (list.length > 0) entries[machineId] = list;
    }
    return entries;
  } catch {
    return {};
  }
}

function saveStored(entries: StoredKeepUnread, storage: Storage | undefined): void {
  try {
    if (Object.keys(entries).length === 0) storage?.removeItem(storageKey);
    else storage?.setItem(storageKey, JSON.stringify(entries));
  } catch {
    // Ignore localStorage quota/privacy errors: keeping a marker is a convenience.
  }
}
