import { message } from "../localization/service";

export default {
  projectsTitle: message("Unmapped Projects", "Unmapped session history heading in the Projects list"),
  workspacesTitle: message("Unmapped Workspaces", "Unmapped session history heading in the Workspaces list"),
  noLocation: message("(no recorded location)", "Unmapped session group whose sessions never recorded a working directory"),
  unmappedBadge: message("unmapped", "Badge for an unmapped session group whose directory still exists"),
  deletedBadge: message("deleted", "Badge for an unmapped session group whose directory no longer exists"),
  sessionMeta: message<{ count: number }>("read-only · {count, plural, one {# message} other {# messages}}", "Read-only unmapped session hint and message count"),
};
