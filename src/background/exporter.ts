import { VIEWER_CSS, VIEWER_JS } from "../report/_bundle";
import type { SessionEvent, SessionMeta } from "../shared/schema";
import { loadEvents, loadSession } from "./session";
import { loadAllScreenshots } from "./screenshots";

const escapeForJsonScript = (s: string): string => s.replace(/<\/script/gi, "<\\/script");

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return c;
    }
  });

const slugify = (s: string): string => {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
  return base || "session";
};

const ts = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}`
  );
};

export const buildReportHtml = (
  meta: SessionMeta,
  events: SessionEvent[],
  endedAt: number,
  screenshots: Record<string, string>,
): string => {
  const session = JSON.stringify({ meta, events, endedAt });
  const shots = JSON.stringify(screenshots);
  const titleAttr = escapeHtml(meta.title || "Web Reporter — Bug Report");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${titleAttr}</title>
<style>${VIEWER_CSS}</style>
</head>
<body>
<div id="app"></div>
<script id="wr-session" type="application/json">${escapeForJsonScript(session)}</script>
<script id="wr-screenshots" type="application/json">${escapeForJsonScript(shots)}</script>
<script>${VIEWER_JS}</script>
</body>
</html>`;
};

export const exportSession = async (): Promise<{ filename: string; bytes: number }> => {
  const meta = await loadSession();
  if (!meta) throw new Error("No active session to export");
  const [events, screenshots] = await Promise.all([loadEvents(), loadAllScreenshots()]);
  const endedAt = Date.now();

  const html = buildReportHtml(meta, events, endedAt, screenshots);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const filename = `web-reporter-${slugify(meta.title)}-${ts()}.html`;

  try {
    await chrome.downloads.download({ url, filename, saveAs: true });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  return { filename, bytes: html.length };
};
