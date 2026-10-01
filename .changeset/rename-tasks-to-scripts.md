---
"@jmfederico/pi-web": minor
---

Rename the built-in command-runner panel from **Tasks** to **Workspace Scripts**, with canonical manifests at `.pi-web/scripts.json` (workspace) and `<data-dir>/scripts.json` (global). An existing `.pi-web/tasks.json` or `<data-dir>/tasks.json` from an earlier version is still read and copied to the new path on first load, so no manual migration is required.

Add a built-in **Tasks** panel (bundled plugin id `tintinweb-pi-tasks`, after the `@tintinweb/pi-tasks` extension that writes the files) that lists the Pi agent's `TaskCreate`/`TaskUpdate` tasks for the active workspace, read from `.pi/tasks/` through the public files API. It is view-only and refreshes with workspace file changes. The command-runner plugin keeps its historical `workspace-tasks` package id and directory.
