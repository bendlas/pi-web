---
"@jmfederico/pi-web": patch
---

Show the complete arguments of a tool call in its card. The arguments open as JSON next to the output, start expanded for calls without a diff, and collapse long input behind a show-all button, so nested values such as a tmux match pattern or an event filter stay readable instead of appearing as a placeholder. Argument summaries that mention nested values keep their content too.
