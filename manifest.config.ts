import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

export default defineManifest({
  manifest_version: 3,
  name: "Web Reporter",
  description: "Record manual-test sessions and export a single-file HTML bug report. 100% local.",
  version: pkg.version,
  action: {
    default_title: "Web Reporter",
    default_popup: "src/popup/popup.html",
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
  ],
  permissions: ["activeTab", "storage", "scripting", "tabs", "downloads"],
});
