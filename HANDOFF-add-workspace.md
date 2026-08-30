# Hand-off: "Add workspace" button (git worktree, no session)

Work relocated out of `main` into a dedicated worktree so `main` stays clean.

- **Worktree:** `/home/herwig/.pi/pi-web-worktrees/add-workspace`
- **Branch:** `feat/add-workspace`
- **Base:** `main` @ `49a5eed` (feat: make archive location configurable)
- **Commit:** `6b98efb` "feat: add-workspace button creates a git worktree without a session"

`node_modules` in the worktree is a symlink to the main checkout's `node_modules`, so
tests/build run without reinstalling. `package-lock.json` and the unrelated untracked
dirs (`.pi/`, `docs/notifications/`) were intentionally left on `main` and are not part
of this change.

## What it does

Adds an **Add workspace** (`+`) button in the Workspaces panel header for Git projects.
It creates a git worktree **directly from the UI, without spinning up a session**:

```
git worktree add <parent>/<name> -b <branchName> [<baseRef>]
```

- `name` — required worktree directory name (and default branch name).
- `baseRef` — optional ref to branch from; defaults to the main checkout's current branch.
- `branchName` — optional new branch name; defaults to `name`.

The worktree parent directory defaults to a sibling `<repo>-worktrees` next to the main
checkout, or is taken from the new config key `git.worktreeParentDir` (project config wins
over global config wins over the sibling default). After creation the workspace list
refreshes automatically.

## Config

`git.worktreeParentDir` (absolute, or relative to the project root):

```json
{ "git": { "worktreeParentDir": "../my-repo-worktrees" } }
```

Documented in `docs/config.md` → "Add-workspace worktree location".

## Files changed (29 files, +1074 / −18)

Server protocol / types
- `src/shared/workspaceCreationProtocol.ts` (+ test) — `parseWorkspaceCreationRequest`, `CreateWorkspaceRequest`.
- `src/shared/apiTypes.ts` — `PiWebGitConfig`, `git?` on `PiWebConfigValues`.
- `src/shared/pluginApiTypes.ts` — `WorkspaceProviderCapabilities.create?`.
- `src/server-plugin-api.ts` — `ProviderCreateInput`, `ProviderCreateContext`, `WorkspaceProvider.createWorkspace?`.
- `src/server-plugin-api.test.ts` — capability key assertion updated.

Git plugin (the `WorkspaceProvider` that owns creation for Git projects)
- `pi-web-plugins/git/server-plugin.ts` (+ test) — `createWorkspace`.

Workspace authority
- `src/server/workspaces/workspaceProviderRegistry.ts` (+ test) — `createWorkspace`, `parseProviderCreateInput`, `validateCreatedWorkspace`, `WorkspaceProviderCreateError`.
- `src/server/workspaces/workspaceCreateService.ts` — HTTP status mapping, `WorkspaceCreationError`.
- `src/server/workspaces/projectPiWebConfig.ts` (+ test) — `resolveWorktreeParentDir`, `loadEffectiveWorktreeParentDir`.

Routes (mirrors the existing workspace-removal flow)
- `src/server/workspaceCreationRoutes.ts` — web proxy → sessiond, attaches `effectiveConfig`, returns 201.
- `src/server/sessiond/workspaceCreationRoutes.ts` — sessiond owns effect; `POST /workspace-creations/projects/:projectId/workspaces`.
- `src/server/sessiond.ts` — registers the route, exposes `workspaceCreations` runtime + `onWorkspacesMutated`.
- `src/server/app.ts` — registers under both `/api` and `/api/machines/:machineId`.

Client
- `src/client/src/api/clients.ts` (+ test) — `workspacesApi.createWorkspace`.
- `src/client/src/api/parsers.ts` (+ test) — `create` capability parsed.
- `src/client/src/workspaceCreation.ts` — `canCreateWorkspace`.
- `src/client/src/components/WorkspaceCreateDialog.ts` — 3-field dialog.
- `src/client/src/components/WorkspaceList.ts` — `+` button (gated by `canCreateWorkspace`).
- `src/client/src/components/appShell/AppNavigationPanel.ts` — prop passthrough.
- `src/client/src/components/PiWebApp.ts` — open/submit/select wiring + dialog render.

Changeset: `.changeset/add-workspace-button.md`.

## Post-move verification

```sh
cd /home/herwig/.pi/pi-web-worktrees/add-workspace

# 0. Full build (tsc server -> dist, plugins, vite client) — clean
npm run build

# 1. Typecheck (clean)
npx tsc --noEmit

# 2. Lint (feature files clean; see "Lint note" below)
npx eslint "src/server/workspaceCreationRoutes.ts" \
  "src/server/workspaces/workspaceProviderRegistry.ts" \
  "src/server/workspaces/workspaceCreateService.ts" \
  "src/server/workspaces/projectPiWebConfig.ts" \
  "src/server/sessiond/workspaceCreationRoutes.ts" \
  "src/shared/workspaceCreationProtocol.ts" \
  "pi-web-plugins/git/server-plugin.ts" \
  "src/client/src/api/clients.ts" "src/client/src/api/parsers.ts" \
  "src/client/src/workspaceCreation.ts" \
  "src/client/src/components/WorkspaceCreateDialog.ts" \
  "src/client/src/components/WorkspaceList.ts"

# 3. Unit tests (fast)
npx vitest run --config vitest.config.ts \
  src/shared/workspaceCreationProtocol.test.ts \
  src/server/workspaces/workspaceProviderRegistry.test.ts \
  src/server/workspaces/projectPiWebConfig.test.ts \
  src/client/src/api/clients.test.ts \
  src/client/src/api/parsers.test.ts \
  src/server-plugin-api.test.ts

# 3b. Git plugin tests are slow in this sandbox FS (~28s each vs the 5s default).
#     They PASS, but need a longer per-test timeout:
npx vitest run --config vitest.config.ts pi-web-plugins/git/server-plugin.test.ts --testTimeout 120000
```

### Manual E2E

1. Build and run from the **worktree** (not `main`): `npm run build`, then start the
   session daemon and web/UI from this worktree.
2. Open a **Git** project → Workspaces panel → click **+**.
3. Enter a name (and optional base ref / branch name) → Create.
4. A new worktree appears under `git.worktreeParentDir` (default `<repo>-worktrees`);
   the workspace list refreshes.

## Operational notes

- **Session daemon restart is required.** `src/server/sessiond.ts` changed (new
  `workspaceCreations` runtime + route). `start:sessiond` runs `tsx src/server/sessiond.ts`
  directly from source (it is NOT served from `dist`), so the long-lived
  `pi-web-sessiond.service` must be **restarted manually** for the new route to be picked up.
  The `pi-web-ui-dev.service` autoreload picks up the client/server changes on its own
  (and `npm run build` already regenerated `dist`).
- The feature only takes effect when running from this worktree (the running services are
  still on `main`, which no longer contains these changes).

## Lint note (pre-existing, not introduced here)

`src/client/src/components/PiWebApp.ts` lines ~1014–1019 have 3 lint errors
(`prefer-optional-chain`, `no-unnecessary-condition`, `restrict-template-expressions`) that
exist on `main` at `49a5eed` already (verified by reverting the file and re-linting). They
are in notification code unrelated to this feature and were left untouched to keep the diff
focused. They can be cleaned up separately if the project's lint gate flags them.
