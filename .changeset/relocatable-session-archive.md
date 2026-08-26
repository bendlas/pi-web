---
"@jmfederico/pi-web": patch
---

Allow relocating the whole session archive instead of only new archive destinations. `sessionArchive.parentDir`, or the nonempty `PI_WEB_ARCHIVE_PARENT` environment variable, moves both the `archived-sessions.json` index and the default `archived-sessions/` directory; `sessionArchive.directory` still overrides the destination for new archives alone. Restart the session daemon to apply the change. Existing records keep their stored paths, and no data is migrated.
