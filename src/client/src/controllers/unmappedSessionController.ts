import { api as defaultApi } from "../api";
import { HttpRequestError } from "../api/http";
import { BrowserErrorReporter, machineBrowserErrorScope } from "../browserErrors";
import { selectedMachineId, type GetState, type SetState } from "./types";

export interface UnmappedSessionControllerDependencies {
  api?: Pick<typeof defaultApi, "unmappedSessions">;
}

/**
 * Loads the machine's unmapped-history index: every persisted session whose cwd
 * no live project/workspace exposes, grouped by cwd and view-only. Kept separate
 * from {@link ProjectController} so project loading and history indexing fail
 * independently.
 */
export class UnmappedSessionController {
  private readonly api: NonNullable<UnmappedSessionControllerDependencies["api"]>;
  private readonly browserErrors: BrowserErrorReporter;

  constructor(
    private readonly getState: GetState,
    private readonly setState: SetState,
    deps: UnmappedSessionControllerDependencies = {},
  ) {
    this.api = deps.api ?? defaultApi;
    this.browserErrors = new BrowserErrorReporter(getState, setState);
  }

  async load(): Promise<void> {
    const machineId = selectedMachineId(this.getState());
    try {
      const response = await this.api.unmappedSessions(machineId);
      if (selectedMachineId(this.getState()) !== machineId) return;
      this.setState({ unmappedGroups: response.groups });
    } catch (error) {
      // A 404 means the connected session daemon predates this route (rolling
      // upgrade). There is simply no index to show yet, not a failure to report.
      if (error instanceof HttpRequestError && error.status === 404) {
        if (selectedMachineId(this.getState()) === machineId) this.setState({ unmappedGroups: [] });
        return;
      }
      this.browserErrors.report(machineBrowserErrorScope(machineId), String(error));
    }
  }
}
