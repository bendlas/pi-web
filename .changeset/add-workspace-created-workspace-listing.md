---
"@jmfederico/pi-web": patch
---

Show a newly created workspace in the workspace list immediately, and make it removable right away. The Add-workspace flow no longer depends on the Git worktree file watcher, so workspaces created in a Jujutsu project (or any provider whose topology is not a Git worktree) appear in the list and expose their delete action without a reload.
