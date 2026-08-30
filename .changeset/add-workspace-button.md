---
"@jmfederico/pi-web": patch
---

Add an "Add workspace" button that creates a git worktree directly from the UI, without starting a session. The worktree is created under a configured location (`git.worktreeParentDir`, defaulting to a sibling `<repo>-worktrees` directory), and branched from an optional base ref with an optional branch name.
