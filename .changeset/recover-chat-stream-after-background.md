---
"@jmfederico/pi-web": patch
---

Reconnect chat after returning to the tab, silently check visible conversations periodically, and show a notice only when messages may be out of date or a refresh fails. Allow a brief grace period for reconnecting so quick tab resumes do not flash a warning. Keep drafts intact, bound refresh requests, and only mark completed output read after it has been displayed.
