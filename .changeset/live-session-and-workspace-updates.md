---
"@jmfederico/pi-web": minor
---

Live-update the session list and the workspace switcher when they change outside PI WEB, without a manual reload. Renaming a session — including through an extension that writes a `session_info` entry directly — now reflects in the sidebar, archived section, and all-sessions viewer, and creating or removing a Git worktree (or switching a branch) reflects in the workspace switcher and sidebar while leaving the open session and selection untouched.

The session daemon detects both by watching the session-store roots and each project's git worktree registry (`.git/worktrees` recursively, plus `.git/HEAD` for the main worktree's branch) instead of re-enumerating on a timer, so a change costs one file read rather than a full listing. The name scan and the topology watcher are both coalesced, so at most one pass is ever in flight.
