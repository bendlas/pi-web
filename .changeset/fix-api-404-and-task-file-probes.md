---
"@jmfederico/pi-web": patch
---

Answer unmatched `/api/...` requests with a JSON 404 instead of the HTML app shell, and report non-JSON responses from the client API layer as clear request errors, so a missing or version-skewed route no longer surfaces as `SyntaxError: Unexpected token '<'`.

Load the Tasks panel only from task files that exist in the workspace, avoiding `400 Path does not exist` requests for sessions without a task file.