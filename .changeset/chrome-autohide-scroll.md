---
"@jmfederico/pi-web": minor
---

Slide the chat header (context bar / mobile tabs) and the prompt input area out of the way when scrolling up through message history, and bring them back into view when scrolling down or when pinned to the live tail. The chat emits a `chat-chrome-visibility` event as scroll direction changes; the app collapses the header and input so the transcript reclaims the space, and keeps them visible while the composer is focused or a session is at the bottom.
