---
"@jmfederico/pi-web": patch
---

Make sessions whose working directory was deleted (removed worktrees, unmapped projects) open read-only instead of failing with a 404: the transcript is now read straight from its session file when the stored cwd no longer exists. Deleted-cwd history is also listed faster, with each project's workspaces resolved concurrently.

Also stop the session daemon from spinning up Git/Jujutsu on every plugin request. Workspace topology changes are now picked up only from the existing per-repository file watches (inotify), which drop the cached workspace topology only on a real change; previously every plugin backend request invalidated the cache, so the daemon continuously re-listed every project's worktrees and pinned a CPU core.
