---
"@jmfederico/pi-web": patch
---

Live-update the workspace list when a project's workspace topology changes outside PI WEB.

Creating or removing a Git worktree, or switching a branch, now reflects in the workspace switcher and sidebar without a manual reload. The workspace catalog is owned by a plugin (for example the Git worktree provider) that re-enumerates on every query and does not push change notifications, so the daemon now polls each known project's workspace resolution on an interval, diffs it against the last seen topology, and emits a global `workspaces.changed` event for any project whose topology changed. The client refreshes that project's workspace list on the event through the existing selection-preserving path, so the open session and selection are left untouched.
