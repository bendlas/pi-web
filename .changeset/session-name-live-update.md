---
"@jmfederico/pi-web": patch
---

Live-update the session list when a session is renamed outside the daemon.

Renaming a session now reflects in the sidebar, archived section, and all-sessions viewer without a manual reload. The server already emitted `session.name` for the built-in `/name` command and generated names, but paths that append a `session_info` entry externally (such as a session-name extension's `setSessionName` or any direct writer) never produced that event, so the listing stayed stale until the next reload. The daemon now detects `session_info` name changes during its heartbeat and emits a global `session.name` event for each one, and `publishSessionName` invalidates the cached summary so the next listing re-reads the renamed file. The client already maps the event onto `state.sessions` and the selected session, so clearing the name (empty or missing) falls back to the default label.
