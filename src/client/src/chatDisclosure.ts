export interface ChatDisclosureSnapshot {
  open: string[];
  closedDefaultOpen: string[];
}

export interface ChatDisclosureStorage {
  read(sessionId: string): ChatDisclosureSnapshot | undefined;
  write(sessionId: string, snapshot: ChatDisclosureSnapshot): void;
}

const GROUP_STORAGE_PREFIX = "pi-web:chat-groups:";

const browserChatDisclosureStorage: ChatDisclosureStorage = {
  read(sessionId: string): ChatDisclosureSnapshot | undefined {
    try {
      if (typeof localStorage === "undefined") return undefined;
      const raw = localStorage.getItem(groupStorageKey(sessionId));
      if (raw === null || raw === "") return undefined;
      return parseDisclosureSnapshot(JSON.parse(raw));
    } catch {
      return undefined;
    }
  },

  write(sessionId: string, snapshot: ChatDisclosureSnapshot): void {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(groupStorageKey(sessionId), JSON.stringify(snapshot));
    } catch {
      // Ignore storage failures; group disclosure should still work for this render.
    }
  },
};

export class ChatDisclosureController {
  private sessionId = "";
  private openKeys = new Set<string>();
  private closedDefaultOpenKeys = new Set<string>();

  constructor(private readonly storage: ChatDisclosureStorage = browserChatDisclosureStorage) {}

  syncSession(sessionId: string): void {
    if (this.sessionId === sessionId) return;
    this.sessionId = sessionId;
    const snapshot = sessionId === "" ? undefined : this.storage.read(sessionId);
    this.openKeys = new Set(snapshot?.open ?? []);
    this.closedDefaultOpenKeys = new Set(snapshot?.closedDefaultOpen ?? []);
  }

  isOpen(key: string, defaultOpen: boolean): boolean {
    if (defaultOpen) return !this.closedDefaultOpenKeys.has(key);
    return this.openKeys.has(key);
  }

  applyToggle(key: string, open: boolean, defaultOpen: boolean): boolean {
    const wasOpen = this.isOpen(key, defaultOpen);
    const nextOpenKeys = new Set(this.openKeys);
    const nextClosedDefaultOpenKeys = new Set(this.closedDefaultOpenKeys);

    if (defaultOpen) {
      nextOpenKeys.delete(key);
      if (open) nextClosedDefaultOpenKeys.delete(key);
      else nextClosedDefaultOpenKeys.add(key);
    } else {
      nextClosedDefaultOpenKeys.delete(key);
      if (open) nextOpenKeys.add(key);
      else nextOpenKeys.delete(key);
    }

    const nextOpen = defaultOpen ? !nextClosedDefaultOpenKeys.has(key) : nextOpenKeys.has(key);
    if (nextOpen === wasOpen && setsEqual(nextOpenKeys, this.openKeys) && setsEqual(nextClosedDefaultOpenKeys, this.closedDefaultOpenKeys)) return false;

    this.openKeys = nextOpenKeys;
    this.closedDefaultOpenKeys = nextClosedDefaultOpenKeys;
    this.persist();
    return true;
  }

  /**
   * Record an explicit open that must outlive a later flip of the same key's
   * default. Event groups are default-open while they are the live tail and
   * default-closed once finished; marking the group open when the user opens a
   * block inside it keeps that block visible across the flip.
   */
  markOpen(key: string): boolean {
    if (this.openKeys.has(key) && !this.closedDefaultOpenKeys.has(key)) return false;
    const nextOpenKeys = new Set(this.openKeys);
    nextOpenKeys.add(key);
    const nextClosedDefaultOpenKeys = new Set(this.closedDefaultOpenKeys);
    nextClosedDefaultOpenKeys.delete(key);
    this.openKeys = nextOpenKeys;
    this.closedDefaultOpenKeys = nextClosedDefaultOpenKeys;
    this.persist();
    return true;
  }

  snapshot(): ChatDisclosureSnapshot {
    return {
      open: [...this.openKeys],
      closedDefaultOpen: [...this.closedDefaultOpenKeys],
    };
  }

  private persist(): void {
    if (this.sessionId === "") return;
    this.storage.write(this.sessionId, this.snapshot());
  }
}

export function groupStorageKey(sessionId: string): string {
  return `${GROUP_STORAGE_PREFIX}${sessionId}`;
}

export function parseDisclosureSnapshot(value: unknown): ChatDisclosureSnapshot | undefined {
  if (Array.isArray(value)) {
    return { open: stringItems(value), closedDefaultOpen: [] };
  }
  if (!isRecord(value)) return undefined;
  return {
    open: Array.isArray(value["open"]) ? stringItems(value["open"]) : [],
    closedDefaultOpen: Array.isArray(value["closedDefaultOpen"]) ? stringItems(value["closedDefaultOpen"]) : [],
  };
}

function stringItems(items: unknown[]): string[] {
  return items.filter((item): item is string => typeof item === "string");
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const item of left) {
    if (!right.has(item)) return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
