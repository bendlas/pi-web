---
"@jmfederico/pi-web": patch
---

Keep an unanswered `ask_user` question set visible across a session daemon reload.

The open ask used to live only in the daemon's in-memory `PendingAskStore`, which is recreated empty on every `sessiond` restart. Because the browser rehydrates the question widget solely from `SessionStatus`, a daemon reload dropped the widget even when questions were still unanswered, and the user could no longer answer them.

The open ask is now persisted to `session-pending-asks.json` in the data directory (mirroring how unread and notification state already survive reloads). The store writes through on every open/answer/cancel, re-reads it at daemon startup, and re-validates each entry against the current schema so a corrupt file drops one bad ask instead of the rest. Graceful daemon shutdown no longer discards open asks, since the session can be reopened afterward and the answer still arrives as the follow-up message that wakes it.
