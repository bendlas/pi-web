---
"@jmfederico/pi-web": patch
---

Fix a session daemon CPU and memory leak in the session-name scan.

The 2s heartbeat fire-and-forgets `detectSessionNameChanges`, which calls `sessionManager.listAll()` to re-enumerate every session and read each name so renames written outside the daemon are reflected live. The scan had no overlap guard, so when `listAll` took longer than the heartbeat interval — easily the case with many sessions, since it `readdir`s the store and reads every session file — each tick started another full enumeration on top of the previous one. The scans piled up unbounded, re-enumerating all sessions concurrently and driving CPU spikes and memory growth until GC reclaimed them.

The scan is now coalesced: a pass that is still running makes the next tick (or a manual call) a no-op, so at most one enumeration is ever in flight. It is also throttled to every 10s, since session names change far less often than the heartbeat ticks and the steady-state cost of re-enumerating all sessions every 2s was itself significant. The unread-catalog reconciliation already guarded itself the same way; this brings the name scan in line with it.
