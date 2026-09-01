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
