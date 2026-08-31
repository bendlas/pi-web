---
"@jmfederico/pi-web": minor
---

Add an optional "Add a comment" box to each question in an Ask User card. The comment rides alongside the answer — a selection or custom "Other" text — instead of replacing it, and is sent back to the agent with the submission. A comment on its own does not count as an answer, so unanswered-question gating, the answered count, and the record's "Answered" flag ignore it; it is still kept as a draft for the next reload. Comments are length-bounded (4,000 chars) and validated on submit, and a comment typed beside a pre-filled selection survives switching the selection.
