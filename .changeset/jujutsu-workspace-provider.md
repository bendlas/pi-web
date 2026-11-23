---
"@jmfederico/pi-web": patch
---

Add a bundled Jujutsu workspace provider. Projects inside a `jj` repository, including colocated `jj git` repositories, are owned by Jujutsu instead of the Git worktree fallback: the workspace list shows Jujutsu workspaces, and removing one runs `jj workspace forget`. The provider stays inactive where the `jj` executable is not installed, and can be disabled in **Settings → PI WEB plugins** to restore Git behavior.
