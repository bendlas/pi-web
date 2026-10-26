import type { PiWebConfigResponse } from "../../api";
import { mergeSelectedSettingsResponse } from "./settingsConfigUpdate";

export function mergeSelectedMachineAccessConfig(base: PiWebConfigResponse, selectedMachine: PiWebConfigResponse): PiWebConfigResponse {
  return mergeSelectedSettingsResponse(base, selectedMachine, ["installationName", "pathAccess", "uploads", "attachments", "maxUploadBytes"]);
}
