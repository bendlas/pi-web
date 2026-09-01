---
"@jmfederico/pi-web": minor
---

Add a "Keep unread" toggle per session so its unread marker stays visible after you open and read the conversation. The preference is browser-local (per machine, in `localStorage`); reading a pinned conversation no longer clears its marker, and the session list gains a "Keep unread" / "Stop keeping unread" action alongside "Mark as read".

The kept-unread marker now propagates to the owning workspace and project (and the machine) in the navigation panel, so they no longer go dark once the conversation is read — and the badges stay lit even when you are looking at a *different* workspace or project than the one holding the pinned session. Each pin records the session's owning workspace and project at pin time, so the roll-up no longer depends on the client's selected-scoped session and workspace lists (which only cover the open workspace/project and would otherwise miss pins elsewhere). Unread is now a single client-owned set — daemon completions unioned with the keep-unread pins — and that one set drives both the session rows and the workspace/project/machine badges, so a pinned conversation lights its row and its navigation badges together and they stay in lock-step as you move between sessions.

"Stop keeping unread" and "Mark as read" are now the same action: both end with the conversation read and not pinned, so the menu shows a single unread control instead of two near-identical ones.
