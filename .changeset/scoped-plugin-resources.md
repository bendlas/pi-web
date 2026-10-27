---
"@jmfederico/pi-web": patch
---

Add scoped plugin resource URLs for streaming generated documents, media, and other binary data through PI WEB, including remote machines and plugin-managed range responses. Plugins can provide bytes from their companion backend without exposing a separate HTTP port. Restart the session daemon after upgrading to enable this API.
