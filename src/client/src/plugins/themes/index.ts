import type { PiWebPlugin } from "../types";
import definitions from "./themes.messages";

export const themePackPlugin: PiWebPlugin = {
  apiVersion: 5,
  name: "PI WEB Themes",
  activate: ({ localization }) => {
    if (localization === undefined) throw new Error("The built-in theme pack requires host localization");
    const messages = localization.registerMessages("themes", definitions);
    return { contributions: {
      themes: [
        {
          id: "pi-web-dark",
          get name() { return messages.t("darkName"); },
          get description() { return messages.t("darkDescription"); },
          order: 10,
          colorScheme: "dark",
          stylesheets: [{ id: "palette", url: new URL("./pi-web-dark.css?no-inline", import.meta.url).href }],
        },
        {
          id: "pi-web-light",
          get name() { return messages.t("lightName"); },
          get description() { return messages.t("lightDescription"); },
          order: 20,
          colorScheme: "light",
          stylesheets: [{ id: "palette", url: new URL("./pi-web-light.css?no-inline", import.meta.url).href }],
        },
        {
          id: "classic",
          get name() { return messages.t("classicName"); },
          get description() { return messages.t("classicDescription"); },
          order: 30,
          colorScheme: "dark",
          stylesheets: [{ id: "palette", url: new URL("./classic.css?no-inline", import.meta.url).href }],
        },
        {
          id: "paper",
          get name() { return messages.t("paperName"); },
          get description() { return messages.t("paperDescription"); },
          order: 40,
          colorScheme: "light",
          stylesheets: [{ id: "palette", url: new URL("./paper.css?no-inline", import.meta.url).href }],
        },
        {
          id: "graphite",
          get name() { return messages.t("graphiteName"); },
          get description() { return messages.t("graphiteDescription"); },
          order: 50,
          colorScheme: "dark",
          stylesheets: [{ id: "palette", url: new URL("./graphite.css?no-inline", import.meta.url).href }],
        },
      ],
      themePairs: [
        {
          id: "pi-web",
          get name() { return messages.t("piWebPairName"); },
          get description() { return messages.t("piWebPairDescription"); },
          order: 10,
          light: "pi-web-light",
          dark: "pi-web-dark",
        },
        {
          id: "paper-graphite",
          get name() { return messages.t("neutralPairName"); },
          get description() { return messages.t("neutralPairDescription"); },
          order: 20,
          light: "paper",
          dark: "graphite",
        },
      ],
    } };
  },
};
