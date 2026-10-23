import type { PiWebConfigResponse, PiWebConfigValues } from "../../api";

export function mergeSelectedMachineAccessConfig(base: PiWebConfigResponse, selectedMachine: PiWebConfigResponse): PiWebConfigResponse {
  return {
    ...base,
    config: mergeAccessConfig(base.config, selectedMachine.config),
    effectiveConfig: mergeAccessConfig(base.effectiveConfig, selectedMachine.effectiveConfig),
  };
}

function mergeAccessConfig(base: PiWebConfigValues, selectedMachine: PiWebConfigValues): PiWebConfigValues {
  const remainder = { ...base };
  delete remainder.installationName;
  return {
    ...remainder,
    ...(selectedMachine.installationName === undefined ? {} : { installationName: selectedMachine.installationName }),
    ...(selectedMachine.pathAccess === undefined ? {} : { pathAccess: selectedMachine.pathAccess }),
    ...(selectedMachine.uploads === undefined ? {} : { uploads: selectedMachine.uploads }),
    ...(selectedMachine.attachments === undefined ? {} : { attachments: selectedMachine.attachments }),
    ...(selectedMachine.maxUploadBytes === undefined ? {} : { maxUploadBytes: selectedMachine.maxUploadBytes }),
  };
}
