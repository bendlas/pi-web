---
"@jmfederico/pi-web": patch
---

Fix unread markers lingering on a project/workspace after the session that
justified them disappears.

There were two distinct causes, both now fixed:

1. **Keep-unread pins (browser-local).** The daemon already sweeps its own
   unread catalog for vanished cwds, but the keep-unread pins were never
   reconciled against reality, so a pinned session that was archived or deleted
   — or whose workspace was removed — kept its project/workspace/machine badge
   lit forever, with no child session carrying the marker. Keep-unread pins are
   now reconciled on every topology or selected-session-list change: pruned when
   their workspace is no longer tracked, when their session was explicitly
   deleted, or when their session was archived or has vanished from the selected
   workspace's list (guarded so a transient empty refresh never prunes a live
   pin). Pins for other (unloaded) workspaces survive, because the client cannot
   see their sessions and the feature is meant to light badges across workspaces.
   Legacy id-only pins survive unless their session is deleted.

2. **Daemon-owned unread for a vanished worktree.** The daemon rolls
   `core:unread` up the workspace tree by working directory, which can light a
   workspace/project for a session the client can no longer show — for example an
   unread record whose git worktree was deleted while the session id still lingered
   in the daemon's registry. The badge then stays lit with no session row to
   justify it. `reconcileUnreadCatalog` now drops unread attributed to a cwd whose
   directory no longer exists on disk, so such orphans self-heal instead of
   persisting in `session-unread.json`. The client additionally suppresses the
   selected workspace's `unread` badge (and cascades to its project and the
   machine) when no visible session in that workspace actually carries it and no
   keep-unread pin owns it, so the badge never outlives what the user can see.

Keep-unread markers now also render in a distinct dark blue
(`--pi-keep-unread`, a new theme token) instead of the daemon-completion accent,
on both the session row and the workspace/project navigation badges, so a pinned
marker is easy to tell apart from a fresh completion.

**Note:** picking up the daemon change requires restarting the session daemon
(`pi-web-sessiond.service`); a restart also clears any already-persisted orphan
unread records. The client change needs only the normal UI reload.
