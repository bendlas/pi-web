---
"@jmfederico/pi-web": minor
---

Add a "Keep unread" toggle per session so its unread marker stays visible after you open and read the conversation. The preference is browser-local (per machine, in `localStorage`); reading a pinned conversation no longer clears its marker. The session action menu gains "Keep unread" for a read conversation and "Stop keeping unread" for a pinned one. "Stop keeping unread" and "Mark as read" reach the same state — read and not pinned — so a pinned conversation offers one control instead of both, while "Mark as unread" keeps working for unpinned conversations.

Unread is now a single client-owned set — daemon completions unioned with the keep-unread pins — and that one set drives both the session rows and the workspace/project/machine navigation badges, so they stay in lock-step. Each pin records the session's owning workspace and project at pin time, so a pinned conversation lights its badges even while you are looking at a different workspace or project. Pins are reconciled against the client's topology as it loads: a pin is pruned only once its project list and that project's workspace list are loaded and no longer contain it (or its session was deleted or archived), so a transient empty catalog after a reload or machine switch never drops pins. The daemon's own unread roll-up also drops records whose working directory no longer exists, so a badge cannot outlive the session that justified it.

Keep-unread markers render in a distinct dark blue (`--pi-keep-unread`, a new theme token) instead of the daemon-completion accent, on both the session row and the workspace/project navigation badges.

**Note:** picking up the daemon change requires restarting the session daemon (`pi-web-sessiond.service`); the client change needs only the normal UI reload.
