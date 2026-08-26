/**
 * Browser-local "keep this conversation unread" overrides.
 *
 * Unread itself is daemon-owned: reading a conversation clears it. This store
 * holds the opposite user intent — "leave the marker on even though I looked at
 * it" — which is a per-browser reminder rather than shared session state, so it
 * lives in `localStorage` keyed by machine and session id.
 */

const storageKey = "pi-web.keep-unread.v1";
const EMPTY_SESSION_IDS: ReadonlySet<string> = new Set();

/** `{ [machineId]: sessionId[] }` as persisted. */
type StoredKeepUnread = Record<string, string[]>;

function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** Sessions the user pinned as unread on `machineId`. */
export function loadKeepUnreadIds(machineId: string, storage = browserStorage()): ReadonlySet<string> {
  const sessionIds = loadStored(storage)[machineId];
  return sessionIds === undefined || sessionIds.length === 0 ? EMPTY_SESSION_IDS : new Set(sessionIds);
}

/**
 * Pin or unpin one session. Unpinning removes the id (and the machine entry
 * once it is empty) so a stale override can never resurrect a read marker.
 */
export function setKeepUnread(machineId: string, sessionId: string, keep: boolean, storage = browserStorage()): void {
  const stored = loadStored(storage);
  const current = stored[machineId] ?? [];
  const next = keep ? [...current.filter((id) => id !== sessionId), sessionId] : current.filter((id) => id !== sessionId);
  if (next.length === current.length && next.every((id, index) => id === current[index])) return;
  const entries: StoredKeepUnread = Object.fromEntries(Object.entries(stored).filter(([id]) => id !== machineId));
  if (next.length > 0) entries[machineId] = next;
  saveStored(entries, storage);
}

function loadStored(storage: Storage | undefined): StoredKeepUnread {
  try {
    const raw = storage?.getItem(storageKey);
    if (raw === undefined || raw === null || raw === "") return {};
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    const entries: StoredKeepUnread = {};
    for (const [machineId, sessionIds] of Object.entries(value)) {
      if (!Array.isArray(sessionIds)) continue;
      const ids = [...new Set(sessionIds.filter((id: unknown): id is string => typeof id === "string"))];
      if (ids.length > 0) entries[machineId] = ids;
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
