---
"@jmfederico/pi-web": patch
---

Stop the chat header and input area from resizing the transcript as they hide. They now keep their layout space and slide out of view with a transform proportional to the scroll gesture, so the bars rest at partial positions, follow the scroll in both directions immediately, and the page no longer jumps when scrolling.
