---
"@jmfederico/pi-web": patch
---

Collapse a thinking block once the response has moved past it instead of leaving
every block expanded. Reasoning still opens while it streams, and the text is only
built while the block is open, which keeps a long transcript cheap to lay out.
