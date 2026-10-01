import type { PiWebPlugin } from "@jmfederico/pi-web/plugin-api";
import { SCRIPTS_CONFIG_PATH } from "./workspaceTasksClient.js";
import { defineTasksPanelElement, tasksPanelBadge } from "./tasksPanelElement.js";

// Historical name: the package directory and plugin id stay `workspace-tasks`
// for upstream compatibility, but this plugin now provides the Scripts panel
// (`workspace.scripts`) backed by `.pi-web/scripts.json` (workspace) and
// `<data-dir>/scripts.json` (global). Legacy `.pi-web/tasks.json` is still read
// and migrated on first load. The Pi agent's own task list is a separate panel
// from the `tintinweb-pi-tasks` plugin.
const plugin = {
  apiVersion: 4,
  name: "Workspace Scripts",
  activate: ({ runtimePluginId, html, svg }) => {
    defineTasksPanelElement();

    return {
      contributions: {
        actions: [
          {
            id: "workspace.open-scripts",
            title: "Open Scripts",
            description: `Open the Scripts tab. Configure scripts in ${SCRIPTS_CONFIG_PATH} (workspace) or the pi-web data dir's scripts.json (global). Legacy .pi-web/tasks.json is still read.`,
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
            render: (context) => html`<pi-web-workspace-tasks-panel .context=${context}></pi-web-workspace-tasks-panel>`,
          },
        ],
      },
    };
  },
} satisfies PiWebPlugin;

export default plugin;
