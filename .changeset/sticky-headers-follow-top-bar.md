---
"@jmfederico/pi-web": patch
---

Keep sticky chat message headers attached to the floating top bar when it folds away. The transcript always reserves the bar's height, so the headers used to keep sticking at that reserved inset and floated mid-screen once the bar slid up. They now follow the bar down to the top edge as it hides, using the same CSS transition so both move together.
