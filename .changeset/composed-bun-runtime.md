---
"@jmfederico/pi-web": patch
---

Add optional, best-effort Bun support for installed PI WEB, including terminals and services, while keeping Node.js as the default and recommended production choice. Show the runtime actually used in version and health reports, and clearly report unsupported timeout settings. Existing services need `pi-web install` again to adopt the new launchers; native Pi extensions may not work with Bun.
