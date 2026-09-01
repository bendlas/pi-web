---
"@jmfederico/pi-web": patch
---

Fix terminals leaking their running process after deletion. Closing or disposing a terminal now kills the pty's whole process group (via `kill(-pid, SIGKILL)`) instead of only the shell, so a command such as `npm run dev` is terminated immediately rather than lingering as an orphan until the session daemon is stopped.
