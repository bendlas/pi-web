---
"@jmfederico/pi-web": patch
---

Make the session-name watcher event-driven instead of interval-polling.

The watcher used to re-enumerate every session on the 2s heartbeat (a full `listAll`) to
detect external renames, causing periodic CPU and memory spikes in the session daemon. It
now watches the session-store roots and re-reads only the changed session file (the
summary scanner memoizes it) to emit `session.name`, instead of re-listing every session.
The 2s heartbeat no longer triggers a full re-enumeration. A debounced watch handler
collects the changed files and reads just those, so a single rename costs one file read.
