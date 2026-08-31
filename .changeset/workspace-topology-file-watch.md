---
"@jmfederico/pi-web": patch
---

Make the workspace-topology watcher event-driven instead of interval-polling.

The watcher used to re-enumerate every project's workspaces on a 5s timer (a full
provider resolve per project), causing periodic CPU and memory spikes in the session
daemon even when nothing changed. It now arms an `fs.watch` on each project's git
worktree registry (`.git/worktrees`, watched recursively, plus `.git/HEAD` for the main
worktree's branch) and re-resolves only the project whose watch fired. The 5s timer is
reduced to a cheap, resolve-free reconcile of the watched project set (so projects added
or removed are still picked up). The expensive resolve runs only when a topology actually
changes.
