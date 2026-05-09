import { VIEWER_CSS, VIEWER_JS } from "../report/_bundle";
import type { SessionEvent, SessionMeta } from "../shared/schema";
import { loadEvents, loadSession } from "./session";
import { loadAllScreenshots } from "./screenshots";

export const escapeForJsonScript = (s: string): string =>
  s.replace(/<\/script/gi, "<\\/script");

export const escapeHtml = (s: string): string =>
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

export const slugify = (s: string): string => {
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

const toDataUrl = (html: string): string => {
  const bytes = new TextEncoder().encode(html);
  let bin = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:text/html;base64,${btoa(bin)}`;
};

export const exportSession = async (): Promise<{ filename: string; bytes: number }> => {
  const meta = await loadSession();
  if (!meta) throw new Error("No active session to export");
  const [events, screenshots] = await Promise.all([loadEvents(), loadAllScreenshots()]);
  const endedAt = Date.now();

  const html = buildReportHtml(meta, events, endedAt, screenshots);
  const filename = `web-reporter-${slugify(meta.title)}-${ts()}.html`;
  const url = toDataUrl(html);

  try {
    const id = await chrome.downloads.download({ url, filename, saveAs: true });
    console.log(`[web-reporter] export started, download id=${id}, ${html.length} bytes`);
  } catch (err) {
    console.error("[web-reporter] export failed:", err);
    throw err;
  }

  return { filename, bytes: html.length };
};
