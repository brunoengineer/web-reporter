import { VIEWER_CSS, VIEWER_JS } from "../report/_bundle";
import type { SessionEvent, SessionMeta } from "../shared/schema";
import { getAllEvents, getAllShots } from "./db";
import { loadSession } from "./session";

/**
 * Make a JSON string safe to inline inside `<script type="application/json">`.
 * Both replacements are valid JSON escapes, so JSON.parse yields the original text:
 *  - `</script` would end the element early;
 *  - `<!--` switches the HTML tokenizer into "escaped script data", where a later
 *    `</script>` may not close the element at all.
 */
export const escapeForJsonScript = (s: string): string =>
  s.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "\\u003c!--");

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

export const fileTimestamp = (d: Date = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}`
  );
};

/** Stable ordering: by timestamp, ties keep insertion order. */
export const sortEvents = (events: SessionEvent[]): SessionEvent[] =>
  events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.ts - b.e.ts || a.i - b.i)
    .map((x) => x.e);

export const buildReportHtml = (
  meta: SessionMeta,
  events: SessionEvent[],
  endedAt: number,
  screenshots: Record<string, string>,
): string => {
  const session = JSON.stringify({ meta, events: sortEvents(events), endedAt });
  const shots = JSON.stringify(screenshots);
  const titleAttr = escapeHtml(meta.title.trim() || "Web Reporter — Bug Report");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="generator" content="Web Reporter ${escapeHtml(meta.appVersion ?? "")}" />
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

/** base64 data URL — service workers have no URL.createObjectURL, so this is the only option. */
export const toDataUrl = (html: string): string => {
  const bytes = new TextEncoder().encode(html);
  const CHUNK = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]));
  }
  return `data:text/html;charset=utf-8;base64,${btoa(parts.join(""))}`;
};

export class ExportError extends Error {
  constructor(
    message: string,
    public readonly cancelled: boolean,
  ) {
    super(message);
  }
}

export const exportSession = async (): Promise<{ filename: string; bytes: number }> => {
  const meta = await loadSession();
  if (!meta) throw new ExportError("No active session to export", false);
  const [events, screenshots] = await Promise.all([getAllEvents(), getAllShots()]);
  const endedAt = Date.now();

  const html = buildReportHtml({ ...meta, state: "idle" }, events, endedAt, screenshots);
  const filename = `web-reporter-${slugify(meta.title)}-${fileTimestamp()}.html`;
  const url = toDataUrl(html);
  const bytes = new TextEncoder().encode(html).length;

  try {
    await chrome.downloads.download({ url, filename, saveAs: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const cancelled = /cancel/i.test(msg);
    throw new ExportError(cancelled ? "Export cancelled" : `Export failed: ${msg}`, cancelled);
  }
  return { filename, bytes };
};
