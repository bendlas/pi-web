---
"@jmfederico/pi-web": patch
---

Fix keep-unread pins not lighting workspace/project badges and disappearing
after reload.

Two independent defects in the client, introduced with the feature:

1. **Badges never lit.** `augmentedMachineStatusSnapshots` merged the pins into
   the status tree, then discarded that merged snapshot whenever
   `reconcileVisibleUnread` found nothing to *correct* (the normal case) and
   returned the original daemon snapshot instead. The session row still showed
   the pin because it reads the pinned id set directly, but the workspace,
   project, and machine badges stayed dark. The augmented snapshot is now
   published whenever it differs from the original.

2. **Pins were pruned on reload and machine switch.** Pins are pruned by
   matching their captured workspace against the workspaces the client tracks,
   but the client loads projects and each project's workspace list in separate
   state updates and only ever loads the workspaces it has visited. The
   reconciler treated that incomplete catalog as authoritative, so the first
   `projects` update after a reload (with `workspacesByProjectId` still empty)
   deleted every owner-carrying pin from `localStorage` and lit nothing. Pins are
   now judged only against a loaded catalog: while the project list is empty, and
   for any project whose workspace list has not been fetched, a pin survives; it
   is dropped only when its project is gone from a loaded list or its workspace is
   absent from its project's loaded list.
