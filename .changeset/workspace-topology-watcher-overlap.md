---
"@jmfederico/pi-web": patch
---

Fix a session daemon memory and CPU leak in the workspace topology watcher.

The watcher polled each known project's workspace resolution on an interval to surface externally-driven topology changes (for example a Git worktree created or removed outside PI WEB). Its `setInterval` started a new pass every tick without waiting for the previous one to finish, and a single pass resolves every project through the catalog — a probe plus a list per project, each a bounded provider operation that can take seconds. On machines with many projects, or with a slow provider, passes overlapped without bound; each in-flight pass holds a full workspace listing and spawns provider work, so the daemon's memory and CPU grew until the process was killed by GC. Passes are now coalesced: a pass that is still running makes the next tick (or a manual `scan()`) a no-op, so at most one pass is ever in flight.
