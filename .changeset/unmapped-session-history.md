---
"@jmfederico/pi-web": patch
---

Add an "Unmapped" subsection to Projects and Workspaces that surfaces session history no live project or workspace exposes. Sessions whose working directory was removed, closed, or never registered are grouped by their recorded location (with a deleted/unmapped badge), and the archived store is included, so old conversations stay reachable. These sessions open read-only: the transcript is viewable but the composer and message actions are disabled.
