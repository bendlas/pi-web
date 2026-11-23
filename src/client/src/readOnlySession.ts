import type { SessionInfo } from "./api";

/**
 * Whether a selected session is view-only in the browser. Archived sessions
 * have always been read-only; the unmapped-history index marks its sessions
 * with `readOnly` so they reuse the same read path (messages fetched, no live
 * socket, disabled composer and message actions) without appearing in the
 * Archived listing.
 */
export function isReadOnlySession(session: Pick<SessionInfo, "archived" | "readOnly"> | undefined): boolean {
  return session?.archived === true || session?.readOnly === true;
}
