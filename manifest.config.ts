import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

export default defineManifest({
  manifest_version: 3,
  name: "Web Reporter",
  description:
    "Record manual-test sessions (console, network, actions, screenshots) and export a single-file HTML bug report. 100% local.",
  version: pkg.version,
  icons: {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png",
  },
  action: {
    default_title: "Web Reporter",
    default_popup: "src/popup/popup.html",
    default_icon: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
    },
  },
  options_ui: {
    page: "src/options/options.html",
    open_in_tab: true,
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/index.ts"],
      run_at: "document_start",
      all_frames: false,
    },
    {
      matches: ["<all_urls>"],
      js: ["src/content/injected.ts"],
      run_at: "document_start",
      all_frames: false,
      world: "MAIN",
    },
  ],
  commands: {
    "take-screenshot": {
      suggested_key: { default: "Alt+Shift+S" },
      description: "Take a screenshot of the recorded tab",
    },
  },
  permissions: ["storage", "unlimitedStorage", "tabs", "downloads"],
  host_permissions: ["<all_urls>"],
});
