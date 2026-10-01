---
"@jmfederico/pi-web": minor
---

Add an "Unmapped" subsection to Projects and Workspaces that surfaces session history no live project or workspace exposes. Sessions whose working directory was removed, closed, or never registered are grouped by their recorded location (with a deleted/unmapped badge), and the archived store is included, so old conversations stay reachable. The Projects list shows every unmapped project for the machine, while the Workspaces list scopes its unmapped history to the open project, so only that project's removed worktrees appear beside its live workspaces, labeled relative to the project so the shared path prefix is not repeated. These sessions open read-only: the transcript is viewable but the composer and message actions are disabled. The index is also available for remote machines, so a machine's unmapped history appears the same whether it is local or federated.

Sessions whose working directory was deleted (removed worktrees, unmapped projects) now open read-only from their session file instead of failing with a 404, and their history is listed faster with each project's workspaces resolved concurrently.

The session daemon no longer spins up Git/Jujutsu on every plugin request: workspace topology changes are picked up only from the existing per-repository file watches, which drop the cached workspace topology only on a real change.
