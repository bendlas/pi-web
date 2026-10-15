---
"@jmfederico/pi-web": patch
---

Keep chat follow-scroll aware of expandable blocks that open inside a nested component. A tool card's argument or diff disclosure (and rendered-markdown disclosures) expand within their own shadow root, where native toggle events never reach the transcript, so their added height is now picked up by observing the transcript's blocks instead.
