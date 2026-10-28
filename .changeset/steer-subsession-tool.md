---
"@jmfederico/pi-web": minor
---

Add a `steer_subsession` tool so an agent can redirect a running tracked child without waiting for it to finish. The message is delivered after the child's current turn finishes its tool calls and before its next model call; an idle child receives it as a new turn.

The tool joins the `spawn_subsession` family, is gated by the same `subsessions` setting, and reuses the existing owned-child check, so a session can only steer children it spawned.
