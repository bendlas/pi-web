---
"@jmfederico/pi-web": patch
---

Fix chat scrolling so the transcript no longer jumps or leaves an empty strip at either end when the chrome hides. The header and composer now float over the transcript, which keeps its full height and reserves each group's height, so it reaches the top and bottom borders while the bars slide away on scroll-down and return on scroll-up (or at the live tail and the transcript start). The hide/reveal is a direction toggle animated by CSS instead of a per-frame scroll value.
