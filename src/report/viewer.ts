/**
 * Report viewer. Bundled (with viewer.css) into every exported HTML file.
 * No framework, no network, no string-built HTML — every node is created via createElement so
 * captured content (console messages, selectors, bodies) can never execute.
 */
import type {
  ActionEvent,
  NetworkEvent,
  SessionEvent,
  SessionMeta,
} from "../shared/schema";
import { buildCurl, buildHar } from "./har";
import { buildMarkdown, buildStepsMarkdown } from "./markdown";
import {
  buildSteps,
  computeStats,
  consoleRows,
  dedupeSteps,
  describeKey,
  failedRequests,
  firstPage,
  fmtClock,
  fmtDate,
  fmtDuration,
  fmtIso,
  fmtMs,
  fmtOffset,
  fmtRel,
  fmtSize,
  fmtTime,
  groupErrors,
  hostOf,
  isActionEvent,
  isErrorEvent,
  isFailedRequest,
  niceTickInterval,
  normalizeEvents,
  parseUserAgent,
  pathOf,
  screenshotsOf,
  sessionDuration,
  shortUrl,
  statusBucket,
  truncate,
  uniquePages,
  type ConsoleRow,
  type ReportData,
  type Screenshots,
  type Stats,
  type Step,
} from "./model";

// ------------------------- DOM helpers -------------------------

type Attrs = Record<string, string | number | boolean | undefined | null>;
type Child = string | number | Node | null | undefined | false;

const appendChildren = (node: Node, children: Child | Child[] | undefined) => {
  if (children === undefined) return;
  const arr = Array.isArray(children) ? children : [children];
  for (const c of arr) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
};

const setAttrs = (node: Element, attrs?: Attrs) => {
  if (!attrs) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, String(v));
  }
};

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  children?: Child | Child[],
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  setAttrs(node, attrs);
  appendChildren(node, children);
  return node;
};

const svg = (tag: string, attrs?: Attrs, children?: Child | Child[]): SVGElement => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  setAttrs(node, attrs);
  appendChildren(node, children);
  return node;
};

const ICONS: Record<string, string> = {
  copy: "M5 2.5A1.5 1.5 0 0 1 6.5 1h5A1.5 1.5 0 0 1 13 2.5v7a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 5 9.5v-7Zm1.5-.5a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .5.5h5a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.5-.5h-5ZM3 5.5a.5.5 0 0 1 .5-.5H4v1h-.5v7.5a.5.5 0 0 0 .5.5h5a.5.5 0 0 0 .5-.5V13h1v.5A1.5 1.5 0 0 1 9.5 15h-5A1.5 1.5 0 0 1 3 13.5v-8Z",
  download:
    "M8 1.5a.75.75 0 0 1 .75.75v6.19l1.72-1.72a.75.75 0 1 1 1.06 1.06l-3 3a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 0 1 1.06-1.06l1.72 1.72V2.25A.75.75 0 0 1 8 1.5ZM2.5 10.75a.75.75 0 0 1 .75.75v1.25h9.5V11.5a.75.75 0 0 1 1.5 0v2a.75.75 0 0 1-.75.75h-11a.75.75 0 0 1-.75-.75v-2a.75.75 0 0 1 .75-.75Z",
  print:
    "M4 1.5A1.5 1.5 0 0 1 5.5 0h5A1.5 1.5 0 0 1 12 1.5V4h1.5A1.5 1.5 0 0 1 15 5.5v5a1.5 1.5 0 0 1-1.5 1.5H12v2.5a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 4 14.5V12H2.5A1.5 1.5 0 0 1 1 10.5v-5A1.5 1.5 0 0 1 2.5 4H4V1.5Zm1.5 0V4h5V1.5h-5ZM5 10v4.5h6V10H5Z",
  sun: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 1a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-12a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0Zm0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 13Zm8-5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5ZM3 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 3 8Zm10.657-5.657a.5.5 0 0 1 0 .707l-1.414 1.415a.5.5 0 1 1-.707-.708l1.414-1.414a.5.5 0 0 1 .707 0Zm-9.193 9.193a.5.5 0 0 1 0 .707L3.05 13.657a.5.5 0 0 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0Zm9.193 2.121a.5.5 0 0 1-.707 0l-1.414-1.414a.5.5 0 0 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .707ZM4.464 4.465a.5.5 0 0 1-.707 0L2.343 3.05a.5.5 0 1 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .708Z",
  moon: "M6 .278a.768.768 0 0 1 .08.858 7.208 7.208 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 0 1 .81.316.733.733 0 0 1-.031.893A8.349 8.349 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 0 1 6 .278Z",
  chevron: "M6 3.5 10.5 8 6 12.5",
  external:
    "M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5ZM16 .5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0 0 1h3.793L6.146 9.146a.5.5 0 1 0 .708.708L15 1.707V5.5a.5.5 0 0 0 1 0v-5Z",
  camera:
    "M5.5 2 4.6 3.5H2.5A1.5 1.5 0 0 0 1 5v7a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 15 12V5a1.5 1.5 0 0 0-1.5-1.5h-2.1L10.5 2h-5ZM8 5.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm0 1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z",
  close: "M3.5 3.5l9 9m0-9l-9 9",
  left: "M10 3.5 5.5 8 10 12.5",
  right: "M6 3.5 10.5 8 6 12.5",
};

const icon = (name: keyof typeof ICONS, size = 14): SVGElement => {
  const stroke = name === "chevron" || name === "close" || name === "left" || name === "right";
  return svg(
    "svg",
    { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": "true", class: "icon" },
    svg("path", {
      d: ICONS[name],
      fill: stroke ? "none" : "currentColor",
      stroke: stroke ? "currentColor" : undefined,
      "stroke-width": stroke ? "1.75" : undefined,
      "stroke-linecap": stroke ? "round" : undefined,
      "stroke-linejoin": stroke ? "round" : undefined,
    }),
  );
};

const button = (label: string, opts: { icon?: keyof typeof ICONS; class?: string; title?: string; onClick: () => void }) => {
  const b = el("button", { type: "button", class: `btn ${opts.class ?? ""}`.trim(), title: opts.title }, [
    opts.icon ? icon(opts.icon) : null,
    label,
  ]);
  b.addEventListener("click", opts.onClick);
  return b;
};

// ------------------------- toast + clipboard + download -------------------------

let toastTimer: ReturnType<typeof setTimeout> | undefined;
const toast = (text: string, kind: "ok" | "err" = "ok") => {
  let t = document.getElementById("wr-toast");
  if (!t) {
    t = el("div", { id: "wr-toast", class: "toast", role: "status" });
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.className = `toast show ${kind}`;
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t!.classList.remove("show"), 2200);
};

const copyText = async (text: string, what = "Copied") => {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} to clipboard`);
  } catch {
    // file:// pages sometimes lack clipboard permission; fall back to a selection.
    const ta = el("textarea", { style: "position:fixed;opacity:0" }, text);
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    toast(ok ? `${what} to clipboard` : "Copy failed — select the text manually", ok ? "ok" : "err");
  }
};

const downloadText = (filename: string, text: string, mime = "text/plain") => {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const flash = (node: HTMLElement) => {
  node.classList.remove("flash");
  void node.offsetWidth; // restart animation
  node.classList.add("flash");
  setTimeout(() => node.classList.remove("flash"), 1600);
};

const scrollTo = (node: HTMLElement) => {
  node.scrollIntoView({ behavior: "smooth", block: "center" });
};

// ------------------------- shared context -------------------------

type Ctx = {
  data: ReportData;
  stats: Stats;
  screenshots: Screenshots;
  /** Per-event "make me visible" callbacks, keyed by global event index. */
  revealers: Map<number, () => void>;
  openLightbox: (id: string) => void;
};

const jumpTo = (ctx: Ctx, index: number) => {
  const r = ctx.revealers.get(index);
  if (r) r();
};

const relLabel = (ctx: Ctx, ts: number) =>
  el("span", { class: "rel", title: `${fmtTime(ts)} · ${fmtIso(ts)}` }, `+${fmtRel(ts, ctx.data.meta.startedAt)}`);

const sevLabel = (s: SessionMeta["severity"]) => s;

// ------------------------- header -------------------------

const renderSparkline = (ctx: Ctx): SVGElement | null => {
  const { events, meta, endedAt } = ctx.data;
  const marks = events.filter((e) => isErrorEvent(e) || isFailedRequest(e));
  if (marks.length === 0) return null;
  const W = 160;
  const H = 28;
  const dur = Math.max(endedAt - meta.startedAt, 1);
  const children: SVGElement[] = [
    svg("line", { x1: 0, x2: W, y1: H / 2, y2: H / 2, stroke: "var(--border)", "stroke-width": "1" }),
  ];
  for (const e of marks) {
    const x = Math.min(W, Math.max(0, ((e.ts - meta.startedAt) / dur) * W));
    children.push(
      svg("line", {
        x1: x.toFixed(1),
        x2: x.toFixed(1),
        y1: 4,
        y2: H - 4,
        stroke: e.type === "network" ? "var(--purple)" : "var(--danger)",
        "stroke-width": "1.5",
        "stroke-linecap": "round",
        opacity: "0.9",
      }),
    );
  }
  const node = svg("svg", { class: "summary-spark", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" }, children);
  node.appendChild(svg("title", {}, `${marks.length} errors / failed requests over ${fmtDuration(dur)}`));
  return node;
};

const renderHeader = (ctx: Ctx): HTMLElement => {
  const { meta, events } = ctx.data;
  const stats = ctx.stats;
  const page = firstPage(events);
  const env = page ? parseUserAgent(page.userAgent, page.platform) : null;
  const url = page?.url ?? meta.tab?.url ?? "";
  const titleText = meta.title.trim() || "(untitled session)";

  const themeBtn = el("button", { class: "btn icon-btn", id: "theme-toggle", type: "button", title: "Toggle dark mode" });

  const netEvents = events.filter((e): e is NetworkEvent => e.type === "network");

  const actions = el("div", { class: "summary-actions" }, [
    button("Copy as Markdown", {
      icon: "copy",
      title: "Paste-ready bug report for Jira / GitHub",
      onClick: () => void copyText(buildMarkdown(ctx.data), "Markdown report copied"),
    }),
    netEvents.length > 0
      ? button("HAR", {
          icon: "download",
          title: "Download network log as HAR (import in DevTools → Network)",
          onClick: () =>
            downloadText(`web-reporter-${meta.id.slice(0, 8)}.har`, JSON.stringify(buildHar(netEvents, meta), null, 2), "application/json"),
        })
      : null,
    button("JSON", {
      icon: "download",
      title: "Download raw session data",
      onClick: () =>
        downloadText(`web-reporter-${meta.id.slice(0, 8)}.json`, JSON.stringify({ ...ctx.data }, null, 2), "application/json"),
    }),
    button("", { icon: "print", class: "icon-btn", title: "Print / save as PDF", onClick: () => window.print() }),
    themeBtn,
  ]);

  const stat = (n: number, label: string, cls: string, target: string) => {
    const a = el("a", { class: `stat ${cls}${n > 0 ? " nonzero" : ""}`, href: `#${target}` }, [
      el("b", {}, String(n)),
      ` ${label}`,
    ]);
    return a;
  };
  const failed = stats.net4xx + stats.net5xx + stats.netFail;

  const envChips: Child[] = [];
  if (page && env) {
    envChips.push(
      el("span", { class: "chip", title: page.userAgent }, `${env.browser} ${env.browserVersion}`),
      el("span", { class: "chip" }, env.os),
      el("span", { class: "chip", title: `screen ${page.screen.w}×${page.screen.h}` }, `${page.viewport.w}×${page.viewport.h}${page.dpr && page.dpr !== 1 ? ` @${page.dpr}x` : ""}`),
      el("span", { class: "chip" }, page.language),
      el("span", { class: "chip" }, page.timezone),
    );
  }

  return el("header", { class: "summary" }, [
    el("div", { class: "summary-top" }, [
      el("div", { class: "summary-main" }, [
        el("h1", { class: "summary-title" }, [
          el("span", { class: "summary-title-text" }, titleText),
          el("span", { class: `severity ${meta.severity}` }, sevLabel(meta.severity)),
        ]),
        el("div", { class: "summary-meta" }, [
          url
            ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer", class: "summary-url", title: url }, [
                shortUrl(url, 70),
                icon("external", 11),
              ])
            : el("span", { class: "muted" }, "(no page captured)"),
          el("span", { class: "dot" }, "·"),
          el("span", { title: fmtIso(meta.startedAt) }, fmtDate(meta.startedAt)),
          el("span", { class: "dot" }, "·"),
          el("span", {}, fmtDuration(sessionDuration(ctx.data))),
          ...(envChips.length ? [el("span", { class: "dot" }, "·"), el("span", { class: "chips" }, envChips)] : []),
        ]),
      ]),
      actions,
    ]),
    el("div", { class: "summary-bottom" }, [
      el("div", { class: "summary-stats" }, [
        stat(stats.errors, "errors", "errors", "console"),
        stat(stats.warnings, "warnings", "warnings", "console"),
        stat(failed, "failed requests", "failed", "network"),
        stat(stats.actions, "actions", "", "actions"),
        stat(stats.network, "requests", "", "network"),
        stat(stats.shots, "screenshots", "", "screenshots"),
        stats.notes > 0 ? stat(stats.notes, "notes", "", "notes") : null,
      ]),
      renderSparkline(ctx) as Node | null,
    ]),
  ]);
};

// ------------------------- sidebar -------------------------

type Section = { id: string; label: string; count?: number; alert?: boolean };

const renderSidebar = (sections: Section[]): HTMLElement =>
  el("nav", { class: "sidebar", "aria-label": "Sections" }, [
    el(
      "div",
      { class: "sidebar-links" },
      sections.map((s) =>
        el("a", { href: `#${s.id}`, "data-target": s.id }, [
          el("span", {}, s.label),
          s.count !== undefined ? el("span", { class: `count${s.alert ? " alert" : ""}` }, String(s.count)) : null,
        ]),
      ),
    ),
    el("div", { class: "sidebar-foot" }, "Generated by Web Reporter"),
  ]);

// ------------------------- overview -------------------------

const renderDonut = (parts: { value: number; color: string }[], className = "donut"): SVGElement => {
  const r = 36;
  const c = 2 * Math.PI * r;
  const total = parts.reduce((acc, p) => acc + p.value, 0);
  const children: SVGElement[] = [
    svg("circle", { cx: 50, cy: 50, r, fill: "none", stroke: "var(--border)", "stroke-width": "12" }),
  ];
  if (total > 0) {
    let offset = 0;
    for (const p of parts) {
      if (p.value === 0) continue;
      const len = (p.value / total) * c;
      children.push(
        svg("circle", {
          cx: 50,
          cy: 50,
          r,
          fill: "none",
          stroke: p.color,
          "stroke-width": "12",
          "stroke-dasharray": `${len} ${c - len}`,
          "stroke-dashoffset": String(-offset),
          transform: "rotate(-90 50 50)",
        }),
      );
      offset += len;
    }
  }
  return svg("svg", { class: className, viewBox: "0 0 100 100", "aria-hidden": "true" }, children);
};

const renderOverview = (ctx: Ctx): HTMLElement => {
  const { events, meta } = ctx.data;
  const stats = ctx.stats;
  const apiErrors = stats.net4xx + stats.net5xx + stats.netFail;
  const parts = [
    { label: "Errors", subtitle: "console + runtime", value: stats.errors, color: "var(--danger)", target: "console" },
    { label: "Warnings", subtitle: "console.warn", value: stats.warnings, color: "var(--warn)", target: "console" },
    { label: "Failed requests", subtitle: "4xx · 5xx · network", value: apiErrors, color: "var(--purple)", target: "network" },
    { label: "Screenshots", subtitle: "captured by QA", value: stats.shots, color: "var(--accent)", target: "screenshots" },
  ];
  const total = stats.errors + stats.warnings + apiErrors;

  const issues = el("div", { class: "card overview-issues" }, [
    el("div", { class: "overview-donut-wrap" }, [
      renderDonut(parts.slice(0, 3), "donut donut-lg"),
      el("div", { class: "overview-donut-center" }, [
        el("div", { class: "overview-donut-total" }, String(total)),
        el("div", { class: "overview-donut-label" }, total === 1 ? "issue" : "issues"),
      ]),
    ]),
    el(
      "div",
      { class: "overview-cards" },
      parts.map((p) =>
        el("a", { class: "overview-card", style: `--card-color: ${p.color}`, href: `#${p.target}` }, [
          el("div", { class: "overview-num" }, String(p.value)),
          el("div", { class: "overview-label" }, p.label),
          el("div", { class: "overview-sub" }, p.subtitle),
        ]),
      ),
    ),
  ]);

  // Top errors
  const groups = groupErrors(events);
  const errorsCard = el("div", { class: "card overview-list" }, [
    el("h3", {}, ["Top errors", groups.length ? el("span", { class: "count" }, String(groups.length)) : null]),
    groups.length === 0
      ? el("div", { class: "empty-inline" }, "No errors captured.")
      : el(
          "ul",
          { class: "list" },
          groups.slice(0, 6).map((g) => {
            const li = el("li", { class: "list-row clickable", title: "Show in console" }, [
              el("span", { class: `level-pill level-error` }, g.kind === "runtime" ? "uncaught" : "error"),
              el("span", { class: "list-main mono" }, truncate(g.message.split("\n")[0] ?? "", 140)),
              g.count > 1 ? el("span", { class: "repeat" }, `×${g.count}`) : null,
              el("span", { class: "list-time" }, fmtClock(g.firstTs)),
            ]);
            li.addEventListener("click", () => jumpTo(ctx, g.firstIndex));
            return li;
          }),
        ),
    groups.length > 6 ? el("a", { class: "more", href: "#console" }, `+${groups.length - 6} more in Console`) : null,
  ]);

  // Failed requests
  const failed = failedRequests(events);
  const failedCard = el("div", { class: "card overview-list" }, [
    el("h3", {}, ["Failed requests", failed.length ? el("span", { class: "count" }, String(failed.length)) : null]),
    failed.length === 0
      ? el("div", { class: "empty-inline" }, stats.network === 0 ? "No requests captured." : "All requests succeeded.")
      : el(
          "ul",
          { class: "list" },
          failed.slice(0, 6).map(({ index, event: e }) => {
            const li = el("li", { class: "list-row clickable", title: e.url }, [
              el("span", { class: `level-pill status-${statusBucket(e.status)}` }, e.status === 0 ? "ERR" : String(e.status)),
              el("span", { class: "list-main mono" }, [el("b", {}, e.method), " ", truncate(pathOf(e.url), 90)]),
              el("span", { class: "list-time" }, fmtMs(e.duration)),
            ]);
            li.addEventListener("click", () => jumpTo(ctx, index));
            return li;
          }),
        ),
    failed.length > 6 ? el("a", { class: "more", href: "#network" }, `+${failed.length - 6} more in Network`) : null,
  ]);

  // Environment
  const page = firstPage(events);
  const env = page ? parseUserAgent(page.userAgent, page.platform) : null;
  const pages = uniquePages(events);
  const rows: [string, Child][] = [];
  if (page && env) {
    rows.push(["Browser", `${env.browser} ${env.browserVersion}`]);
    rows.push(["OS", env.os]);
    rows.push(["Viewport", `${page.viewport.w} × ${page.viewport.h}${page.dpr && page.dpr !== 1 ? ` @ ${page.dpr}x` : ""}`]);
    rows.push(["Screen", `${page.screen.w} × ${page.screen.h}`]);
    rows.push(["Locale", `${page.language} · ${page.timezone}`]);
    if (page.online === false) rows.push(["Network", "offline at start"]);
  }
  rows.push(["Started", `${fmtDate(meta.startedAt)} (${fmtDuration(sessionDuration(ctx.data))})`]);
  rows.push(["Pages", pages.length === 0 ? "—" : `${pages.length} URL${pages.length === 1 ? "" : "s"} · ${hostOf(pages[0]!) || pages[0]}`]);
  if (page) {
    const ua = el("span", { class: "ua", title: page.userAgent }, truncate(page.userAgent, 70));
    rows.push(["User agent", ua]);
  }
  const envCard = el("div", { class: "card overview-list" }, [
    el("h3", {}, "Environment"),
    el(
      "dl",
      { class: "kv" },
      rows.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)]),
    ),
  ]);

  return el("div", { class: "overview" }, [issues, el("div", { class: "overview-grid" }, [errorsCard, failedCard, envCard])]);
};

// ------------------------- notes -------------------------

const renderNotes = (ctx: Ctx): HTMLElement => {
  const { meta, events } = ctx.data;
  const notes = meta.notes.trim();
  const markers = events
    .map((event, index) => ({ event, index }))
    .filter((x): x is { event: Extract<SessionEvent, { type: "note" }>; index: number } => x.event.type === "note");

  const children: Child[] = [];
  if (notes) {
    children.push(el("div", { class: "card" }, el("p", { class: "notes-pre" }, notes)));
  }
  if (markers.length > 0) {
    children.push(
      el("div", { class: "card" }, [
        el("h3", { class: "card-h" }, `Notes taken during the session (${markers.length})`),
        el(
          "ul",
          { class: "markers" },
          markers.map(({ event: m, index }) => {
            const li = el("li", { class: "marker clickable", title: "Show in repro steps" }, [
              el("span", { class: "marker-time" }, [fmtClock(m.ts), " ", relLabel(ctx, m.ts)]),
              el("span", { class: "marker-text" }, m.text),
            ]);
            li.addEventListener("click", () => jumpTo(ctx, index));
            return li;
          }),
        ),
      ]),
    );
  }
  if (children.length === 0) {
    return el("div", { class: "card empty" }, "No notes were written for this session.");
  }
  return el("div", { class: "stack" }, children);
};

// ------------------------- repro steps -------------------------

const describeAction = (e: ActionEvent): { tag: string; tagClass: string; main: HTMLElement } => {
  const sel = (s: string) => el("code", { class: "step-sel", title: s }, truncate(s, 70));
  switch (e.type) {
    case "page":
      return {
        tag: "Page",
        tagClass: "tag-page",
        main: el("span", {}, ["Loaded ", el("a", { href: e.url, target: "_blank", rel: "noopener", class: "step-url", title: e.url }, shortUrl(e.url, 80))]),
      };
    case "nav":
      return {
        tag: "Nav",
        tagClass: "tag-nav",
        main: el("span", {}, [`${e.kind} → `, el("span", { class: "step-url", title: e.url }, shortUrl(e.url, 80))]),
      };
    case "click":
      return {
        tag: "Click",
        tagClass: "tag-click",
        main: el("span", {}, [
          e.text ? el("b", {}, `“${truncate(e.text, 50)}”`) : el("span", { class: "muted" }, `<${e.tag.toLowerCase()}>`),
          " ",
          sel(e.selector),
        ]),
      };
    case "input": {
      const label = e.redacted ? "Typed a redacted value in" : e.length === 0 ? "Cleared" : `Typed ${e.length} char${e.length === 1 ? "" : "s"} in`;
      return {
        tag: "Input",
        tagClass: "tag-input",
        main: el("span", {}, [label, " ", sel(e.selector), el("span", { class: "muted" }, ` (${e.inputType})`)]),
      };
    }
    case "submit":
      return { tag: "Submit", tagClass: "tag-submit", main: el("span", {}, ["Submitted ", sel(e.selector)]) };
    case "key":
      return {
        tag: "Key",
        tagClass: "tag-key",
        main: el("span", {}, ["Pressed ", el("kbd", {}, describeKey(e.key)), " in ", sel(e.selector)]),
      };
    case "note":
      return { tag: "Note", tagClass: "tag-note", main: el("span", { class: "step-note" }, e.text) };
  }
};

const renderFollowup = (ctx: Ctx, index: number, f: SessionEvent): HTMLElement | null => {
  if (isErrorEvent(f)) {
    const n = el("div", { class: "step-error clickable", title: "Show in console" }, [
      el("span", { class: "fx-icon" }, "⚠"),
      el("span", { class: "fx-text" }, truncate(f.message.split("\n")[0] ?? "", 200)),
      relLabel(ctx, f.ts),
    ]);
    n.addEventListener("click", () => jumpTo(ctx, index));
    return n;
  }
  if (f.type === "network") {
    const n = el("div", { class: "step-net clickable", title: "Show in network" }, [
      el("span", { class: `level-pill status-${statusBucket(f.status)}` }, f.status === 0 ? "ERR" : String(f.status)),
      el("span", { class: "fx-text" }, [el("b", {}, f.method), " ", truncate(pathOf(f.url), 100)]),
      f.error ? el("span", { class: "muted" }, f.error) : null,
      relLabel(ctx, f.ts),
    ]);
    n.addEventListener("click", () => jumpTo(ctx, index));
    return n;
  }
  if (f.type === "screenshot") {
    const dataUrl = ctx.screenshots[f.id];
    if (!dataUrl) return el("div", { class: "step-shot" }, [icon("camera"), ` screenshot · ${fmtClock(f.ts)} (image not embedded)`]);
    const img = el("img", { src: dataUrl, alt: "screenshot", loading: "lazy" });
    const n = el("div", { class: "step-shot clickable", title: "Open screenshot" }, [img, el("span", {}, [icon("camera"), ` ${fmtClock(f.ts)}`])]);
    n.addEventListener("click", () => ctx.openLightbox(f.id));
    return n;
  }
  return null;
};

const renderRepro = (ctx: Ctx): HTMLElement => {
  const steps = dedupeSteps(buildSteps(ctx.data.events));
  if (steps.length === 0) return el("div", { class: "card empty" }, "No user actions were recorded.");

  const items = steps.map((s: Step) => {
    const d = describeAction(s.event);
    const followups = s.followups.map((f) => renderFollowup(ctx, f.index, f.event)).filter((n): n is HTMLElement => !!n);
    const li = el("li", { class: `repro-step${followups.length ? " has-followups" : ""}`, id: `ev-${s.index}` }, [
      el("div", { class: "step-main" }, [el("span", { class: `step-tag ${d.tagClass}` }, d.tag), d.main, relLabel(ctx, s.event.ts)]),
      followups.length > 0 ? el("div", { class: "step-followup" }, followups) : null,
    ]);
    ctx.revealers.set(s.index, () => {
      location.hash = "#repro";
      scrollTo(li);
      flash(li);
    });
    return li;
  });

  return el("div", {}, [
    el("div", { class: "section-tools" }, [
      el("span", { class: "muted" }, `${steps.length} step${steps.length === 1 ? "" : "s"} · errors, failed requests and screenshots are shown under the step they followed`),
      button("Copy steps", { icon: "copy", onClick: () => void copyText(buildStepsMarkdown(ctx.data), "Steps copied") }),
    ]),
    el("ol", { class: "repro" }, items),
  ]);
};

// ------------------------- timeline -------------------------

type Lane = { key: string; label: string; color: string; match: (e: SessionEvent) => boolean };

const LANES: Lane[] = [
  { key: "notes", label: "Notes", color: "var(--accent)", match: (e) => e.type === "note" },
  { key: "shots", label: "Screenshots", color: "var(--warn)", match: (e) => e.type === "screenshot" },
  { key: "errors", label: "Errors", color: "var(--danger)", match: (e) => isErrorEvent(e) },
  { key: "actions", label: "Actions", color: "var(--info)", match: (e) => isActionEvent(e) && e.type !== "note" },
  { key: "network", label: "Network", color: "var(--purple)", match: (e) => e.type === "network" },
  { key: "console", label: "Console", color: "var(--muted)", match: (e) => e.type === "console" && e.level !== "error" },
];

const describeForTooltip = (e: SessionEvent): string => {
  switch (e.type) {
    case "console":
      return `console.${e.level}: ${truncate(e.message.replace(/\s+/g, " "), 120)}`;
    case "error":
      return `uncaught: ${truncate(e.message, 120)}`;
    case "click":
      return `click ${e.text ? `“${truncate(e.text, 40)}” ` : ""}${truncate(e.selector, 60)}`;
    case "input":
      return `input ${truncate(e.selector, 60)}${e.redacted ? " (redacted)" : ` (${e.length} chars)`}`;
    case "submit":
      return `submit ${truncate(e.selector, 60)}`;
    case "key":
      return `key ${describeKey(e.key)}`;
    case "nav":
      return `${e.kind} ${truncate(shortUrl(e.url), 70)}`;
    case "page":
      return `page ${truncate(shortUrl(e.url), 70)}`;
    case "screenshot":
      return `${e.kind} screenshot`;
    case "note":
      return `note: ${truncate(e.text, 120)}`;
    case "network":
      return `${e.method} ${e.status || "ERR"} ${truncate(shortUrl(e.url), 70)} · ${fmtMs(e.duration)}`;
  }
};

const renderTimeline = (ctx: Ctx): HTMLElement => {
  const { meta, events, endedAt } = ctx.data;
  const wrap = el("div", { class: "timeline-wrap card" });
  const tip = el("div", { class: "timeline-tip", hidden: true });
  const stage = el("div", { class: "timeline-stage" });
  wrap.append(stage, tip);

  const H = 150;
  const padL = 84;
  const padR = 16;
  const padTop = 10;
  const axisH = 22;
  const dur = Math.max(endedAt - meta.startedAt, 1);

  const draw = () => {
    const W = Math.max(320, Math.floor(stage.clientWidth || wrap.clientWidth || 800));
    const innerW = W - padL - padR;
    const laneH = (H - padTop - axisH) / LANES.length;
    const xFor = (ts: number) => padL + Math.min(1, Math.max(0, (ts - meta.startedAt) / dur)) * innerW;

    const children: SVGElement[] = [];

    LANES.forEach((lane, i) => {
      const y = padTop + i * laneH;
      if (i % 2 === 0) {
        children.push(svg("rect", { x: padL, y, width: innerW, height: laneH, fill: "var(--bg-soft)", rx: 2 }));
      }
      children.push(
        svg("text", { x: padL - 10, y: y + laneH / 2 + 3.5, "font-size": "11", fill: "var(--muted)", "text-anchor": "end" }, lane.label),
      );
    });

    // axis ticks
    const step = niceTickInterval(dur, Math.max(4, Math.floor(innerW / 110)));
    const axisY = H - axisH + 6;
    for (let t = 0; t <= dur; t += step) {
      const x = xFor(meta.startedAt + t);
      children.push(svg("line", { x1: x, x2: x, y1: padTop, y2: axisY - 2, stroke: "var(--border)", "stroke-width": "1", "stroke-dasharray": "2 3" }));
      children.push(svg("text", { x, y: axisY + 10, "font-size": "10", fill: "var(--muted)", "text-anchor": "middle" }, `+${fmtOffset(t)}`));
    }

    // markers
    events.forEach((e, index) => {
      const li = LANES.findIndex((l) => l.match(e));
      if (li < 0) return;
      const lane = LANES[li]!;
      const cx = xFor(e.ts);
      const cy = padTop + li * laneH + laneH / 2;
      const failed = e.type === "network" && isFailedRequest(e);
      const dot = svg("circle", {
        cx: cx.toFixed(1),
        cy,
        r: failed ? 5 : 4,
        fill: failed ? "var(--danger)" : lane.color,
        stroke: "var(--bg-card)",
        "stroke-width": "1.5",
        class: "tl-dot",
        "data-index": index,
        tabindex: -1,
      });
      children.push(dot);
    });

    const root = svg("svg", { class: "timeline-svg", viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img" }, children);
    stage.replaceChildren(root);

    root.addEventListener("mousemove", (ev) => {
      const target = ev.target as Element;
      if (!(target instanceof SVGCircleElement)) {
        tip.hidden = true;
        return;
      }
      const index = Number(target.getAttribute("data-index"));
      const e = events[index];
      if (!e) return;
      tip.replaceChildren();
      appendChildren(tip, [
        el("div", { class: "tip-time" }, [fmtClock(e.ts), " ", el("span", { class: "rel" }, `+${fmtRel(e.ts, meta.startedAt)}`)]),
        el("div", { class: "tip-text" }, describeForTooltip(e)),
        ctx.revealers.has(index) || e.type === "screenshot" ? el("div", { class: "tip-hint" }, "click to jump") : null,
      ]);
      tip.hidden = false;
      const rect = wrap.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const tipW = tip.offsetWidth || 240;
      tip.style.left = `${Math.min(x + 12, rect.width - tipW - 8)}px`;
      tip.style.top = `${y + 14}px`;
    });
    root.addEventListener("mouseleave", () => {
      tip.hidden = true;
    });
    root.addEventListener("click", (ev) => {
      const target = ev.target as Element;
      if (!(target instanceof SVGCircleElement)) return;
      const index = Number(target.getAttribute("data-index"));
      const e = events[index];
      if (e?.type === "screenshot") ctx.openLightbox(e.id);
      else jumpTo(ctx, index);
    });
  };

  const legend = el(
    "div",
    { class: "timeline-legend" },
    [
      ...LANES.map((l) => el("span", {}, [el("span", { class: "legend-dot", style: `background:${l.color}` }), l.label])),
      el("span", {}, [el("span", { class: "legend-dot", style: "background:var(--danger)" }), "Failed request"]),
    ],
  );
  wrap.appendChild(legend);

  // Draw once mounted, and again whenever the container resizes.
  requestAnimationFrame(draw);
  if (typeof ResizeObserver !== "undefined") {
    let pending = false;
    new ResizeObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        draw();
      });
    }).observe(stage);
  }
  return wrap;
};

// ------------------------- generic table bits -------------------------

const pill = (label: string, count: number, active: boolean, onClick: () => void) => {
  const p = el("button", { class: `pill${active ? " active" : ""}`, type: "button" }, [label, " ", el("span", { class: "pill-n" }, String(count))]);
  p.addEventListener("click", onClick);
  return p;
};

const searchBox = (placeholder: string, onInput: (q: string) => void) => {
  const input = el("input", { type: "search", class: "search", placeholder, "aria-label": placeholder }) as HTMLInputElement;
  input.addEventListener("input", () => onInput(input.value));
  return input;
};

const collapsible = (summaryText: string, body: HTMLElement, open = false): HTMLDetailsElement => {
  const d = el("details", { class: "collapse", open }, [el("summary", {}, [icon("chevron", 12), summaryText]), body]);
  return d;
};

const tryPrettyJson = (s: string): { text: string; isJson: boolean } => {
  const t = s.trim();
  if (!t || (t[0] !== "{" && t[0] !== "[")) return { text: s, isJson: false };
  try {
    return { text: JSON.stringify(JSON.parse(t), null, 2), isJson: true };
  } catch {
    return { text: s, isJson: false };
  }
};

const kvRow = (label: string, value: Child) => el("div", { class: "detail-row" }, [el("div", { class: "detail-label" }, label), el("div", { class: "detail-value" }, value)]);

// ------------------------- console -------------------------

type ConsoleFilter = "all" | "error" | "warn" | "info" | "log" | "debug";

const renderConsoleDetail = (row: ConsoleRow): HTMLElement => {
  const e = row.event;
  const pretty = tryPrettyJson(e.message);
  const stack = e.type === "error" ? e.stack : undefined;
  const source = e.type === "error" ? e.source : undefined;
  return el("div", { class: "detail" }, [
    el("div", { class: "detail-head" }, [
      kvRow("When", `${fmtDate(e.ts)} · ${fmtTime(e.ts)}`),
      source ? kvRow("Source", el("span", { class: "mono" }, source)) : null,
      row.repeat > 1 ? kvRow("Repeated", `${row.repeat} times in a row`) : null,
      el("div", { class: "detail-actions" }, [
        button("Copy message", { icon: "copy", onClick: () => void copyText(e.message, "Message copied") }),
        stack ? button("Copy stack", { icon: "copy", onClick: () => void copyText(stack, "Stack copied") }) : null,
      ]),
    ]),
    el("div", { class: "detail-section" }, [
      el("h4", {}, ["Message", pretty.isJson ? el("span", { class: "detail-note" }, "JSON · pretty-printed") : null]),
      el("pre", { class: "body-pre" }, pretty.text || "(empty)"),
    ]),
    stack ? el("div", { class: "detail-section" }, [el("h4", {}, "Stack trace"), el("pre", { class: "body-pre stack" }, stack)]) : null,
  ]);
};

const renderConsole = (ctx: Ctx): HTMLElement => {
  const rows = consoleRows(ctx.data.events);
  const stats = ctx.stats;
  if (rows.length === 0) return el("div", { class: "card empty" }, "No console output was captured.");

  const filters: { key: ConsoleFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: rows.length },
    { key: "error", label: "Errors", count: stats.errors },
    { key: "warn", label: "Warnings", count: stats.consoleWarn },
    { key: "info", label: "Info", count: stats.consoleInfo },
    { key: "log", label: "Logs", count: stats.consoleLog },
    { key: "debug", label: "Debug", count: stats.consoleDebug },
  ].filter((f) => f.key === "all" || f.count > 0) as { key: ConsoleFilter; label: string; count: number }[];

  let active: ConsoleFilter = "all";
  let query = "";
  const expanded = new Set<number>();
  const tbody = el("tbody");
  const countLabel = el("div", { class: "table-count" });
  const rowNodes = new Map<number, HTMLTableRowElement>();

  const renderRows = () => {
    tbody.replaceChildren();
    rowNodes.clear();
    const q = query.trim().toLowerCase();
    let visible = 0;
    for (const row of rows) {
      if (active !== "all" && row.level !== active) continue;
      if (q && !row.event.message.toLowerCase().includes(q)) continue;
      visible++;
      const isOpen = expanded.has(row.index);
      const preview = truncate(row.event.message.replace(/\s+/g, " ").trim(), 220) || "(empty)";
      const tr = el("tr", { class: `console-row level-row-${row.level}${isOpen ? " expanded" : ""}`, id: `ev-${row.index}`, tabindex: 0 }, [
        el("td", { class: "col-toggle" }, icon("chevron", 11)),
        el("td", { class: "col-time", title: fmtIso(row.event.ts) }, [fmtClock(row.event.ts), relLabel(ctx, row.event.ts)]),
        el("td", { class: "col-level" }, el("span", { class: `level-pill level-${row.level}` }, row.isRuntime ? "uncaught" : row.level)),
        el("td", { class: "col-msg" }, [preview, row.repeat > 1 ? el("span", { class: "repeat", title: `${row.repeat} identical messages in a row` }, `×${row.repeat}`) : null]),
        el("td", { class: "col-src" }, row.event.type === "error" && row.event.source ? truncate(row.event.source.replace(/^https?:\/\/[^/]+/, ""), 50) : ""),
      ]);
      const toggle = () => {
        if (expanded.has(row.index)) expanded.delete(row.index);
        else expanded.add(row.index);
        renderRows();
      };
      tr.addEventListener("click", toggle);
      tr.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          toggle();
        }
      });
      tbody.appendChild(tr);
      rowNodes.set(row.index, tr);
      if (isOpen) tbody.appendChild(el("tr", { class: "detail-tr" }, el("td", { colspan: 5, class: "detail-cell" }, renderConsoleDetail(row))));
    }
    countLabel.textContent = visible === rows.length ? `${rows.length} entries` : `${visible} of ${rows.length} entries`;
  };

  const pillWrap = el("div", { class: "filters" });
  const renderPills = () => {
    pillWrap.replaceChildren(
      ...filters.map((f) =>
        pill(f.label, f.count, f.key === active, () => {
          active = f.key;
          renderPills();
          renderRows();
        }),
      ),
    );
  };
  renderPills();
  renderRows();

  const search = searchBox("Filter messages…", (q) => {
    query = q;
    renderRows();
  });

  const body = el("div", { class: "collapse-body" }, [
    el("div", { class: "table-controls" }, [pillWrap, search]),
    countLabel,
    el("div", { class: "table-wrap" }, [
      el("table", { class: "console-table" }, [
        el("thead", {}, el("tr", {}, [el("th", { class: "col-toggle" }, ""), el("th", {}, "Time"), el("th", {}, "Level"), el("th", {}, "Message"), el("th", {}, "Source")])),
        tbody,
      ]),
    ]),
  ]);

  const details = collapsible(
    `${rows.length} entries · ${stats.errors} errors · ${stats.consoleWarn} warnings · ${stats.consoleInfo + stats.consoleLog + stats.consoleDebug} other`,
    body,
    false,
  );

  // Revealers: make a specific event visible and highlighted.
  for (const row of rows) {
    ctx.revealers.set(row.index, () => {
      active = "all";
      query = "";
      search.value = "";
      expanded.add(row.index);
      renderPills();
      renderRows();
      details.open = true;
      const tr = rowNodes.get(row.index);
      if (tr) {
        scrollTo(tr);
        flash(tr);
      }
    });
  }

  return details;
};

// ------------------------- network -------------------------

type StatusFilter = "all" | "ok" | "redirect" | "client" | "server" | "fail";
type SortKey = "ts" | "method" | "status" | "url" | "duration" | "size";

const renderHeadersTable = (headers: Record<string, string>): HTMLElement => {
  const entries = Object.entries(headers);
  if (entries.length === 0) return el("div", { class: "detail-empty" }, "(none)");
  return el(
    "table",
    { class: "headers-table" },
    el(
      "tbody",
      {},
      entries.map(([k, v]) => el("tr", {}, [el("td", { class: "header-name" }, k), el("td", { class: `header-value${v === "[REDACTED]" ? " redacted" : ""}` }, v)])),
    ),
  );
};

const renderBodyBlock = (body: string | undefined, contentType: string | undefined, truncated: boolean | undefined, note: string | undefined): HTMLElement => {
  if (body === undefined) return el("div", { class: "detail-empty" }, note ?? "(no body)");
  const isJson = !!contentType && contentType.toLowerCase().includes("json");
  const display = isJson ? tryPrettyJson(body).text : body;
  return el("div", {}, [
    note ? el("div", { class: "body-warn" }, note) : null,
    truncated ? el("div", { class: "body-warn" }, `Truncated to ${fmtSize(body.length)} — the full body was longer.`) : null,
    el("pre", { class: "body-pre" }, display),
  ]);
};

const renderNetworkDetail = (e: NetworkEvent): HTMLElement => {
  const hasDetails = !!e.requestHeaders || e.requestBody !== undefined || !!e.responseHeaders || e.responseBody !== undefined || !!e.responseBodyNote;
  return el("div", { class: "detail" }, [
    el("div", { class: "detail-head" }, [
      kvRow("URL", el("span", { class: "mono selectable" }, e.url)),
      kvRow("Status", `${e.status === 0 ? "failed" : e.status}${e.statusText ? ` ${e.statusText}` : ""}${e.error ? ` — ${e.error}` : ""}`),
      kvRow("Timing", `${fmtClock(e.ts)} · ${fmtMs(e.duration)} · ${e.initiator}`),
      el("div", { class: "detail-actions" }, [
        button("Copy as cURL", { icon: "copy", onClick: () => void copyText(buildCurl(e), "cURL copied") }),
        button("Copy URL", { icon: "copy", onClick: () => void copyText(e.url, "URL copied") }),
        e.responseBody ? button("Copy response", { icon: "copy", onClick: () => void copyText(e.responseBody!, "Response copied") }) : null,
      ]),
    ]),
    !hasDetails
      ? el("div", { class: "detail-empty" }, "Headers and bodies were not captured for this request.")
      : el("div", { class: "detail-cols" }, [
          el("div", { class: "detail-section" }, [
            el("h4", {}, "Request"),
            el("div", { class: "detail-sub" }, "Headers"),
            renderHeadersTable(e.requestHeaders ?? {}),
            el("div", { class: "detail-sub" }, ["Payload", e.requestContentType ? el("span", { class: "detail-note" }, e.requestContentType) : null]),
            renderBodyBlock(e.requestBody, e.requestContentType, e.requestBodyTruncated, e.requestBodyNote),
          ]),
          el("div", { class: "detail-section" }, [
            el("h4", {}, "Response"),
            el("div", { class: "detail-sub" }, "Headers"),
            renderHeadersTable(e.responseHeaders ?? {}),
            el("div", { class: "detail-sub" }, ["Body", e.responseContentType ? el("span", { class: "detail-note" }, e.responseContentType) : null]),
            renderBodyBlock(e.responseBody, e.responseContentType, e.responseBodyTruncated, e.responseBodyNote),
          ]),
        ]),
  ]);
};

const renderNetwork = (ctx: Ctx): HTMLElement => {
  const stats = ctx.stats;
  const entries: { index: number; e: NetworkEvent }[] = [];
  ctx.data.events.forEach((e, index) => {
    if (e.type === "network") entries.push({ index, e });
  });
  if (entries.length === 0) {
    return el("div", { class: "card empty" }, [
      "No network requests were captured. ",
      el("br"),
      el("span", { class: "muted" }, "HAR-lite records fetch and XMLHttpRequest calls only — not images, scripts or stylesheets."),
    ]);
  }

  const filters: { key: StatusFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: stats.network },
    { key: "ok", label: "2xx", count: stats.netOk },
    { key: "redirect", label: "3xx", count: stats.net3xx },
    { key: "client", label: "4xx", count: stats.net4xx },
    { key: "server", label: "5xx", count: stats.net5xx },
    { key: "fail", label: "Failed", count: stats.netFail },
  ].filter((f) => f.key === "all" || f.count > 0) as { key: StatusFilter; label: string; count: number }[];

  let active: StatusFilter = "all";
  let query = "";
  let sortKey: SortKey = "ts";
  let sortDir: 1 | -1 = 1;
  const expanded = new Set<number>();
  const tbody = el("tbody");
  const countLabel = el("div", { class: "table-count" });
  const rowNodes = new Map<number, HTMLTableRowElement>();
  const maxDur = Math.max(1, stats.netMaxDuration);

  const matches = (e: NetworkEvent): boolean => {
    if (active !== "all" && statusBucket(e.status) !== active) return false;
    if (!query.trim()) return true;
    const hay = `${e.method} ${e.url} ${e.status} ${e.initiator}`.toLowerCase();
    return query
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .every((t) => hay.includes(t));
  };

  const sorted = () => {
    const arr = entries.filter((x) => matches(x.e));
    const key = sortKey;
    arr.sort((a, b) => {
      let d = 0;
      if (key === "ts") d = a.e.ts - b.e.ts;
      else if (key === "duration") d = a.e.duration - b.e.duration;
      else if (key === "size") d = (a.e.size ?? -1) - (b.e.size ?? -1);
      else if (key === "status") d = a.e.status - b.e.status;
      else if (key === "method") d = a.e.method.localeCompare(b.e.method);
      else if (key === "url") d = a.e.url.localeCompare(b.e.url);
      return d * sortDir || a.index - b.index;
    });
    return arr;
  };

  const renderRows = () => {
    tbody.replaceChildren();
    rowNodes.clear();
    const list = sorted();
    for (const { index, e } of list) {
      const isOpen = expanded.has(index);
      const bucket = statusBucket(e.status);
      const tr = el("tr", { class: `net-row${isOpen ? " expanded" : ""}${bucket === "client" || bucket === "server" || bucket === "fail" ? " failed" : ""}`, id: `ev-${index}`, tabindex: 0 }, [
        el("td", { class: "col-toggle" }, icon("chevron", 11)),
        el("td", { class: "col-time", title: fmtIso(e.ts) }, [fmtClock(e.ts), relLabel(ctx, e.ts)]),
        el("td", { class: "col-method" }, e.method),
        el("td", { class: "col-status" }, [
          el("span", { class: `level-pill status-${bucket}`, title: e.statusText }, e.status === 0 ? "ERR" : String(e.status)),
        ]),
        el("td", { class: "col-url", title: e.url }, [
          el("span", { class: "url-host" }, hostOf(e.url)),
          el("span", { class: "url-path" }, truncate(pathOf(e.url), 110)),
          e.error ? el("span", { class: "url-err" }, e.error) : null,
        ]),
        el("td", { class: "col-dur" }, [
          el("span", { class: "dur-bar" }, el("span", { class: "dur-fill", style: `width:${Math.max(2, (e.duration / maxDur) * 100).toFixed(1)}%` })),
          el("span", { class: "dur-text" }, fmtMs(e.duration)),
        ]),
        el("td", { class: "col-size" }, fmtSize(e.size)),
        el("td", { class: "col-init" }, e.initiator),
      ]);
      const toggle = () => {
        if (expanded.has(index)) expanded.delete(index);
        else expanded.add(index);
        renderRows();
      };
      tr.addEventListener("click", toggle);
      tr.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          toggle();
        }
      });
      tbody.appendChild(tr);
      rowNodes.set(index, tr);
      if (isOpen) tbody.appendChild(el("tr", { class: "detail-tr" }, el("td", { colspan: 8, class: "detail-cell" }, renderNetworkDetail(e))));
    }
    countLabel.textContent = list.length === entries.length ? `${entries.length} requests` : `${list.length} of ${entries.length} requests`;
    renderHead();
  };

  const pillWrap = el("div", { class: "filters" });
  const renderPills = () => {
    pillWrap.replaceChildren(
      ...filters.map((f) =>
        pill(f.label, f.count, f.key === active, () => {
          active = f.key;
          renderPills();
          renderRows();
        }),
      ),
    );
  };

  const search = searchBox("Filter by URL, method, status…", (q) => {
    query = q;
    renderRows();
  });

  const headRow = el("tr");
  const cols: { key?: SortKey; label: string; cls?: string }[] = [
    { label: "", cls: "col-toggle" },
    { key: "ts", label: "Time" },
    { key: "method", label: "Method" },
    { key: "status", label: "Status" },
    { key: "url", label: "URL" },
    { key: "duration", label: "Duration" },
    { key: "size", label: "Size" },
    { label: "Via" },
  ];
  const renderHead = () => {
    headRow.replaceChildren(
      ...cols.map((c) => {
        const th = el("th", { class: `${c.cls ?? ""}${c.key ? " sortable" : ""}${c.key === sortKey ? ` sorted ${sortDir === 1 ? "asc" : "desc"}` : ""}`.trim() }, c.label);
        if (c.key) {
          th.addEventListener("click", () => {
            if (sortKey === c.key) sortDir = sortDir === 1 ? -1 : 1;
            else {
              sortKey = c.key!;
              sortDir = c.key === "duration" || c.key === "size" ? -1 : 1;
            }
            renderRows();
          });
        }
        return th;
      }),
    );
  };

  renderPills();
  renderRows();

  const body = el("div", { class: "collapse-body" }, [
    el("div", { class: "table-controls" }, [pillWrap, search]),
    countLabel,
    el("div", { class: "table-wrap" }, el("table", { class: "net-table" }, [el("thead", {}, headRow), tbody])),
  ]);

  const details = collapsible(
    `${stats.network} requests · ${stats.netOk + stats.net3xx} ok · ${stats.net4xx} 4xx · ${stats.net5xx} 5xx · ${stats.netFail} failed · ${fmtSize(stats.netBytes)} transferred`,
    body,
    false,
  );

  for (const { index } of entries) {
    ctx.revealers.set(index, () => {
      active = "all";
      query = "";
      search.value = "";
      expanded.add(index);
      renderPills();
      renderRows();
      details.open = true;
      const tr = rowNodes.get(index);
      if (tr) {
        scrollTo(tr);
        flash(tr);
      }
    });
  }

  return details;
};

// ------------------------- actions -------------------------

type ActionFilter = "all" | "click" | "input" | "key" | "nav" | "submit" | "note";

const renderActions = (ctx: Ctx): HTMLElement => {
  const stats = ctx.stats;
  const entries: { index: number; e: ActionEvent }[] = [];
  ctx.data.events.forEach((e, index) => {
    if (isActionEvent(e) && e.type !== "page") entries.push({ index, e });
  });
  if (entries.length === 0) return el("div", { class: "card empty" }, "No user actions were recorded.");

  const filters: { key: ActionFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: entries.length },
    { key: "click", label: "Clicks", count: stats.clicks },
    { key: "input", label: "Inputs", count: stats.inputs },
    { key: "key", label: "Keys", count: stats.keys },
    { key: "submit", label: "Submits", count: stats.submits },
    { key: "nav", label: "Navigations", count: stats.navs },
    { key: "note", label: "Notes", count: stats.notes },
  ].filter((f) => f.key === "all" || f.count > 0) as { key: ActionFilter; label: string; count: number }[];

  let active: ActionFilter = "all";
  const tbody = el("tbody");
  const rowNodes = new Map<number, HTMLTableRowElement>();

  const renderRows = () => {
    tbody.replaceChildren();
    rowNodes.clear();
    for (const { index, e } of entries) {
      if (active !== "all" && e.type !== active) continue;
      let typeLabel: string = e.type;
      let selector = "";
      let detail: Child = "";
      switch (e.type) {
        case "click":
          selector = e.selector;
          detail = e.text ? `“${truncate(e.text, 70)}”` : e.href ? truncate(e.href, 70) : "";
          break;
        case "input":
          selector = e.selector;
          detail = e.redacted ? el("span", { class: "level-pill level-warn" }, "redacted") : `${e.length} chars · ${e.inputType}`;
          break;
        case "key":
          selector = e.selector;
          detail = el("kbd", {}, describeKey(e.key));
          break;
        case "submit":
          selector = e.selector;
          break;
        case "nav":
          typeLabel = `nav · ${e.kind}`;
          detail = truncate(shortUrl(e.url), 90);
          break;
        case "note":
          detail = el("span", { class: "step-note" }, e.text);
          break;
        case "page":
          break;
      }
      const tr = el("tr", { id: `ev-${index}` }, [
        el("td", { class: "col-time", title: fmtIso(e.ts) }, [fmtClock(e.ts), relLabel(ctx, e.ts)]),
        el("td", { class: "col-type" }, el("span", { class: `step-tag tag-${e.type}` }, typeLabel)),
        el("td", { class: "col-selector" }, selector),
        el("td", { class: "col-detail" }, detail),
      ]);
      tbody.appendChild(tr);
      rowNodes.set(index, tr);
    }
  };

  const pillWrap = el("div", { class: "filters" });
  const renderPills = () => {
    pillWrap.replaceChildren(
      ...filters.map((f) =>
        pill(f.label, f.count, f.key === active, () => {
          active = f.key;
          renderPills();
          renderRows();
        }),
      ),
    );
  };
  renderPills();
  renderRows();

  return el("div", {}, [
    el("div", { class: "table-controls" }, [pillWrap]),
    el("div", { class: "table-wrap" }, [
      el("table", { class: "actions-table" }, [
        el("thead", {}, el("tr", {}, [el("th", {}, "Time"), el("th", {}, "Type"), el("th", {}, "Selector"), el("th", {}, "Detail")])),
        tbody,
      ]),
    ]),
  ]);
};

// ------------------------- screenshots + lightbox -------------------------

const renderScreenshots = (ctx: Ctx): HTMLElement => {
  const shots = screenshotsOf(ctx.data.events);
  if (shots.length === 0) {
    return el("div", { class: "card empty" }, ["No screenshots were taken. ", el("span", { class: "muted" }, "Use the popup button or Alt+Shift+S while recording.")]);
  }
  const cards = shots.map(({ event: s }, i) => {
    const dataUrl = ctx.screenshots[s.id];
    const card = el("figure", { class: `shot-card${dataUrl ? " clickable" : ""}` }, [
      dataUrl ? el("img", { src: dataUrl, alt: `Screenshot ${i + 1}`, loading: "lazy" }) : el("div", { class: "shot-missing" }, "(image not embedded)"),
      el("figcaption", { class: "shot-meta" }, [
        el("span", { class: "shot-n" }, `#${i + 1}`),
        el("span", { class: "shot-time" }, [fmtClock(s.ts), " ", relLabel(ctx, s.ts)]),
        s.title || s.url ? el("span", { class: "shot-page", title: s.url }, truncate(s.title || hostOf(s.url ?? ""), 40)) : null,
      ]),
    ]);
    if (dataUrl) card.addEventListener("click", () => ctx.openLightbox(s.id));
    return card;
  });
  return el("div", { class: "shots-grid" }, cards);
};

const setupLightbox = (data: ReportData, screenshots: Screenshots) => {
  const shots = screenshotsOf(data.events).filter((s) => !!screenshots[s.event.id]);
  let backdrop: HTMLElement | null = null;
  let current = 0;

  const close = () => {
    backdrop?.remove();
    backdrop = null;
    document.removeEventListener("keydown", onKey);
  };
  const show = (i: number) => {
    if (!backdrop || shots.length === 0) return;
    current = (i + shots.length) % shots.length;
    const s = shots[current]!.event;
    const img = backdrop.querySelector("img")!;
    img.src = screenshots[s.id]!;
    img.alt = `Screenshot ${current + 1} of ${shots.length}`;
    backdrop.querySelector(".lb-counter")!.textContent = `${current + 1} / ${shots.length}`;
    backdrop.querySelector(".lb-caption")!.textContent = `${fmtClock(s.ts)} · +${fmtRel(s.ts, data.meta.startedAt)}${s.title ? ` · ${s.title}` : ""}${s.url ? ` · ${shortUrl(s.url, 60)}` : ""}`;
    (backdrop.querySelector(".lb-download") as HTMLAnchorElement).href = screenshots[s.id]!;
    (backdrop.querySelector(".lb-download") as HTMLAnchorElement).download = `screenshot-${current + 1}.${screenshots[s.id]!.startsWith("data:image/png") ? "png" : "jpg"}`;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight") show(current + 1);
    else if (e.key === "ArrowLeft") show(current - 1);
  };

  return (id: string) => {
    const idx = shots.findIndex((s) => s.event.id === id);
    if (idx < 0) return;
    close();
    const img = el("img", { alt: "" });
    const stop = (fn: () => void) => (ev: Event) => {
      ev.stopPropagation();
      fn();
    };
    backdrop = el("div", { class: "lightbox", role: "dialog", "aria-modal": "true", "aria-label": "Screenshot" }, [
      el("div", { class: "lb-top" }, [
        el("span", { class: "lb-counter" }),
        el("span", { class: "lb-caption" }),
        el("a", { class: "btn lb-download", href: "#", title: "Download image" }, [icon("download"), "Download"]),
        el("button", { class: "btn icon-btn lb-close", type: "button", title: "Close (Esc)" }, icon("close")),
      ]),
      el("button", { class: "lb-nav lb-prev", type: "button", title: "Previous (←)" }, icon("left", 20)),
      el("div", { class: "lb-stage" }, img),
      el("button", { class: "lb-nav lb-next", type: "button", title: "Next (→)" }, icon("right", 20)),
    ]);
    backdrop.querySelector(".lb-close")!.addEventListener("click", stop(close));
    backdrop.querySelector(".lb-prev")!.addEventListener("click", stop(() => show(current - 1)));
    backdrop.querySelector(".lb-next")!.addEventListener("click", stop(() => show(current + 1)));
    backdrop.querySelector(".lb-download")!.addEventListener("click", (ev) => ev.stopPropagation());
    img.addEventListener("click", (ev) => ev.stopPropagation());
    backdrop.addEventListener("click", close);
    if (shots.length < 2) backdrop.classList.add("single");
    document.addEventListener("keydown", onKey);
    document.body.appendChild(backdrop);
    show(idx);
  };
};

// ------------------------- raw -------------------------

const renderRaw = (ctx: Ctx): HTMLElement => {
  const payload = {
    meta: ctx.data.meta,
    endedAt: ctx.data.endedAt,
    eventsCount: ctx.data.events.length,
    screenshotsEmbedded: Object.keys(ctx.screenshots).length,
    events: ctx.data.events,
  };
  const json = JSON.stringify(payload, null, 2);
  return el("div", {}, [
    el("div", { class: "section-tools" }, [
      el("span", { class: "muted" }, `${ctx.data.events.length} events · ${fmtSize(json.length)} (screenshots excluded)`),
      el("span", { class: "tools-right" }, [
        button("Copy JSON", { icon: "copy", onClick: () => void copyText(json, "JSON copied") }),
        button("Download JSON", { icon: "download", onClick: () => downloadText(`web-reporter-${ctx.data.meta.id.slice(0, 8)}.json`, json, "application/json") }),
      ]),
    ]),
    collapsible("Show raw JSON", el("pre", { class: "raw-pre mono" }, json)),
  ]);
};

// ------------------------- theme / nav / print -------------------------

const setupTheme = () => {
  const root = document.documentElement;
  const saved = localStorage.getItem("wr.theme");
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const current = (): "dark" | "light" => {
    const attr = root.getAttribute("data-theme");
    if (attr === "dark" || attr === "light") return attr;
    return prefersDark ? "dark" : "light";
  };
  if (saved === "dark" || saved === "light") root.setAttribute("data-theme", saved);
  const btn = document.getElementById("theme-toggle");
  const paint = () => {
    if (!btn) return;
    btn.replaceChildren(icon(current() === "dark" ? "sun" : "moon"));
    btn.title = current() === "dark" ? "Switch to light mode" : "Switch to dark mode";
  };
  paint();
  btn?.addEventListener("click", () => {
    const next = current() === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    localStorage.setItem("wr.theme", next);
    paint();
  });
};

const setupActiveSection = () => {
  const links = new Map<string, HTMLAnchorElement>();
  document.querySelectorAll<HTMLAnchorElement>("nav.sidebar a[data-target]").forEach((a) => {
    const t = a.getAttribute("data-target");
    if (t) links.set(t, a);
  });
  const sections = Array.from(document.querySelectorAll<HTMLElement>("section[id]"));
  if (sections.length === 0) return;

  const headerH = () => (document.querySelector(".summary") as HTMLElement | null)?.offsetHeight ?? 100;
  const update = () => {
    const offset = headerH() + 40;
    let active = sections[0]!.id;
    for (const s of sections) {
      if (s.getBoundingClientRect().top - offset <= 0) active = s.id;
      else break;
    }
    if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 2) active = sections[sections.length - 1]!.id;
    links.forEach((a, id) => a.classList.toggle("active", id === active));
  };
  let scheduled = false;
  const onScroll = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      update();
    });
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  update();
};

const setupPrint = () => {
  window.addEventListener("beforeprint", () => {
    document.querySelectorAll("details").forEach((d) => d.setAttribute("open", ""));
  });
};

// ------------------------- bootstrap -------------------------

const readJson = <T>(id: string, fallback: T): T => {
  const node = document.getElementById(id);
  if (!node || !node.textContent) return fallback;
  try {
    return JSON.parse(node.textContent) as T;
  } catch {
    return fallback;
  }
};

const renderEmpty = (): HTMLElement =>
  el("div", { class: "empty-state" }, [
    el("h1", {}, "No session data"),
    el("p", {}, "Open the Web Reporter extension, record a session, and export it to populate this report."),
  ]);

const section = (id: string, title: string, body: HTMLElement, sub?: string) =>
  el("section", { id }, [el("div", { class: "section-head" }, [el("h2", { class: "section-h" }, title), sub ? el("span", { class: "section-sub" }, sub) : null]), body]);

const bootstrap = () => {
  const raw = readJson<{ meta?: SessionMeta; events?: SessionEvent[]; endedAt?: number }>("wr-session", {});
  const screenshots = readJson<Screenshots>("wr-screenshots", {});
  const app = document.getElementById("app");
  if (!app) return;
  if (!raw.meta) {
    app.appendChild(renderEmpty());
    return;
  }

  const events = normalizeEvents(raw.events ?? []);
  const data: ReportData = {
    meta: {
      ...raw.meta,
      severity: raw.meta.severity ?? "medium",
      notes: raw.meta.notes ?? "",
      title: raw.meta.title ?? "",
      tab: raw.meta.tab ?? null,
      appVersion: raw.meta.appVersion ?? "",
    },
    events,
    endedAt: raw.endedAt ?? (events.length > 0 ? events[events.length - 1]!.ts : raw.meta.startedAt),
  };
  const stats = computeStats(events);
  const ctx: Ctx = { data, stats, screenshots, revealers: new Map(), openLightbox: setupLightbox(data, screenshots) };

  document.title = `${data.meta.title.trim() || "Bug report"} — Web Reporter`;

  app.appendChild(renderHeader(ctx));

  const failed = stats.net4xx + stats.net5xx + stats.netFail;
  const sections: Section[] = [
    { id: "overview", label: "Overview" },
    { id: "notes", label: "Notes", count: (data.meta.notes.trim() ? 1 : 0) + stats.notes || undefined },
    { id: "repro", label: "Repro steps", count: dedupeSteps(buildSteps(events)).length },
    { id: "timeline", label: "Timeline" },
    { id: "console", label: "Console", count: stats.consoleAll + stats.runtimeErrors, alert: stats.errors > 0 },
    { id: "network", label: "Network", count: stats.network, alert: failed > 0 },
    { id: "actions", label: "Actions", count: stats.actions + stats.notes },
    { id: "screenshots", label: "Screenshots", count: stats.shots },
    { id: "raw", label: "Raw JSON" },
  ];
  app.appendChild(renderSidebar(sections));

  // Order matters: Console/Network register revealers that Overview/Repro/Timeline call lazily,
  // so everything can be built in any order as long as the registry is shared.
  const main = el("main", {}, [
    section("overview", "Overview", renderOverview(ctx)),
    section("notes", "Notes", renderNotes(ctx)),
    section("repro", "Repro steps", renderRepro(ctx)),
    section("timeline", "Timeline", renderTimeline(ctx), "hover for details · click a marker to jump"),
    section("console", "Console", renderConsole(ctx)),
    section("network", "Network", renderNetwork(ctx), "HAR-lite: fetch + XHR only"),
    section("actions", "Actions", renderActions(ctx)),
    section("screenshots", "Screenshots", renderScreenshots(ctx)),
    section("raw", "Raw JSON", renderRaw(ctx)),
  ]);
  app.appendChild(main);

  setupTheme();
  setupActiveSection();
  setupPrint();
};

bootstrap();
