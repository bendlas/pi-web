---
"@jmfederico/pi-web": patch
---

Fix the Captain's Log companion and the workspace-reviews example for Pi's split `before_agent_start` event. Pi now delivers that event as a union of user and custom variants, and `prompt` exists only on the user variant. Reading it unconditionally failed the plugin typecheck, which aborted `npm run build` after `dist` was cleaned and left the bundled Terminal plugin and shipped Pi packages unemitted, so the session daemon exited with a missing required Terminal package.
