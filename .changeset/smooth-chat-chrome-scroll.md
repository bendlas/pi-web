---
"@jmfederico/pi-web": patch
---

Fix chat scrolling so the transcript no longer jumps or leaves an empty strip when the chrome hides. The composer now floats over the transcript, which keeps its full height and reserves the composer's height at the end, so the transcript reaches the lower border while the composer slides down out of view on scroll-down and returns on scroll-up or at the live tail. The hide/reveal is a direction toggle animated by CSS instead of a per-frame scroll value.
