---
"@jmfederico/pi-web": patch
---

Speed up cross-project session listings (session cleanup, external-rename detection, and the Unmapped history index) so they no longer re-parse every transcript. These now share the lightweight summary scanner already used for per-workspace listings, which skips message bodies and answers unchanged files from a stat-only memo. Appended transcripts are folded incrementally instead of re-read whole, per-directory scanning is bounded, and overlapping Unmapped-index requests are coalesced, keeping CPU and disk reads low while a session streams.
