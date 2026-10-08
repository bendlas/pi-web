---
"@jmfederico/pi-web": patch
---

Federate the `GET /sessions/unmapped` route so remote-machine workspaces can load their unmapped session history. Previously the browser requested `/api/machines/<id>/sessions/unmapped`, no proxy route matched it, and the server answered with the HTML app shell, surfacing as `SyntaxError: Unexpected token '<'`.

Answer unmatched `/api/...` requests with a JSON 404 instead of the HTML app shell, and report non-JSON responses from the client API layer as clear request errors.

Load the Tasks panel only from task files that exist in the workspace, avoiding `400 Path does not exist` requests for sessions without a task file.
