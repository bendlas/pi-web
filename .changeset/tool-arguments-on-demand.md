---
"@jmfederico/pi-web": patch
---

Keep a tool card's full arguments available on demand instead of expanding them
for every call. The arguments block starts collapsed and its JSON is only built
while it is open, which keeps a long transcript cheap to lay out.
