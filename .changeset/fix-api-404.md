---
"@jmfederico/pi-web": patch
---

Answer unmatched `/api/...` requests with a JSON 404 instead of the HTML app shell, and report non-JSON responses from the client API layer as clear request errors, so a missing or version-skewed route no longer surfaces as `SyntaxError: Unexpected token '<'`.
