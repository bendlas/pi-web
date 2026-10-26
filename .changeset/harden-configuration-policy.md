---
"@jmfederico/pi-web": patch
---

Reject unknown core configuration fields instead of silently discarding deployment policy, and reject extension-dialog timeouts that would overflow runtime timers. Preserve hidden environment-controlled overrides during legacy config saves, and show base filesystem roots separately from configurable additions in Settings.
