import type { PiWebPlugin } from "@jmfederico/pi-web/plugin-api";
import { invalidateTasksPanel, renderTasksPanel } from "./tasksPanel.js";

/**
 * Built-in Tasks panel (plugin id `tintinweb-pi-tasks`): a read-only view of
 * the Pi agent's task list (`TaskCreate`/`TaskUpdate`, as written by the
 * `@tintinweb/pi-tasks` extension) for the selected workspace, read from
 * `<workspace>/.pi/tasks/` through the public `files` capability.
 */
const plugin = {
  apiVersion: 4,
  name: "Tasks",
  activate: ({ html, svg }) => ({
    contributions: {
      workspacePanels: [
        {
          id: "workspace.tasks",
          title: "Tasks",
          icon: svg`
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="9" y1="6" x2="20" y2="6"></line>
              <line x1="9" y1="12" x2="20" y2="12"></line>
              <line x1="9" y1="18" x2="20" y2="18"></line>
              <polyline points="3 6 4 7 6 5"></polyline>
              <polyline points="3 12 4 13 6 11"></polyline>
              <polyline points="3 18 4 19 6 17"></polyline>
            </svg>
          `,
          order: 100,
          invalidationResources: ["workspace.files"],
          onInvalidate: (context) => { invalidateTasksPanel(context); },
          render: (context) => renderTasksPanel(html, context),
        },
      ],
    },
  }),
} satisfies PiWebPlugin;

export default plugin;
