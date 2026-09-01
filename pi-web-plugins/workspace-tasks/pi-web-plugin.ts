import type { StylesheetIntegrationCapabilityV1, PiWebPlugin, PluginCapability } from "@jmfederico/pi-web/plugin-api";
import { SCRIPTS_CONFIG_PATH } from "./workspaceTasksClient.js";
import { defineTasksPanelElement, tasksPanelBadge } from "./tasksPanelElement.js";

const stylesheetIntegrationCapability: PluginCapability<StylesheetIntegrationCapabilityV1, 1> = {
  pluginId: "pi-web", id: "stylesheet-integration", version: 1,
  parse(value) {
    if (!isStylesheetIntegration(value)) {
      throw new Error("Stylesheet integration capability v1 requires registerRoot and createController");
    }
    return value;
  },
};

function isStylesheetIntegration(value: unknown): value is StylesheetIntegrationCapabilityV1 {
  return typeof value === "object" && value !== null
    && "registerRoot" in value && typeof value.registerRoot === "function"
    && "createController" in value && typeof value.createController === "function"
    && "subscribe" in value && typeof value.subscribe === "function";
}

// Historical name: the package directory and plugin id stay `workspace-tasks`
// for upstream compatibility, but this plugin now provides the Scripts panel
// (`workspace.scripts`) backed by `.pi-web/scripts.json`. Legacy
// `.pi-web/tasks.json` is still read and migrated on first load. The Pi agent's
// own task list is a separate panel from the `tintinweb-pi-tasks` plugin.
//
// Note on incoming upstream work: a machine-wide scripts manifest is
// intentionally not read here. Upstream is adding host-managed
// cross-machine plugin-backend requests for exactly this kind of machine-local
// data, so that behavior belongs on that transport rather than on a direct PI
// WEB API call from the browser plugin. Revisit this when the stack rebases
// onto it.
const plugin = {
  apiVersion: 4,
  name: "Workspace Scripts",
  requires: [stylesheetIntegrationCapability],
  activate: ({ runtimePluginId, html, svg }) => {
    defineTasksPanelElement();
    let stylesheetIntegration: StylesheetIntegrationCapabilityV1 | undefined;

    return {
      start({ capabilities }) {
        stylesheetIntegration = capabilities.resolve(stylesheetIntegrationCapability);
      },
      contributions: {
        actions: [
          {
            id: "workspace.open-scripts",
            title: "Open Scripts",
            description: `Open the Scripts tab. Configure scripts in ${SCRIPTS_CONFIG_PATH}. Legacy .pi-web/tasks.json is still read.`,
            group: "Workspace",
            enabled: (context) => context.state.selectedWorkspace !== undefined,
            run: (context) => {
              if (context.state.selectedWorkspace === undefined) return;
              context.selectWorkspaceTool(`${runtimePluginId}:workspace.scripts`);
            },
          },
        ],
        workspacePanels: [
          {
            id: "workspace.scripts",
            title: "Scripts",
            icon: svg`
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 6h11"></path>
                <path d="M9 12h11"></path>
                <path d="M9 18h11"></path>
                <path d="m4 6 .8 .8L6.5 5"></path>
                <path d="m4 12 .8 .8 1.7-1.8"></path>
                <path d="m4 18 .8 .8 1.7-1.8"></path>
              </svg>
            `,
            order: 40,
            badge: (context) => tasksPanelBadge(context),
            render: (context) => html`<pi-web-workspace-tasks-panel .stylesheetIntegration=${stylesheetIntegration} .context=${context}></pi-web-workspace-tasks-panel>`,
          },
        ],
      },
    };
  },
} satisfies PiWebPlugin;

export default plugin;
