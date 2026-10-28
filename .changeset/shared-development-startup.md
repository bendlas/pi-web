---
"@jmfederico/pi-web": patch
---

Use shared development startup lifecycles so prerequisites run consistently and a failed UI service stops its sibling instead of leaving a partially running group. Existing native development installations can adopt the new supervision by running `pi-web install --dev` once from the updated checkout, including their existing `--config` option when applicable; reinstalling services interrupts active sessions and terminals. Docker development installations receive the change through their normal update flow.
