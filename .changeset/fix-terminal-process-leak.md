---
"@jmfederico/pi-web": patch
---

Fix terminals leaking their running process after deletion. Closing or disposing a terminal now hangs the shell up and then kills the pty's whole process group (via `kill(-pid, SIGKILL)`), so a command such as `npm run dev` is terminated even when the shell ignores SIGHUP. An interactive shell still forwards the hangup to its backgrounded job, and a job the user disowned is left running.
