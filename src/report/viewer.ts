import type {
  ClickEvent,
  ConsoleEvent,
  FormInputEvent,
  FormSubmitEvent,
  NavEvent,
  PageEvent,
  RuntimeErrorEvent,
  ScreenshotEvent,
  SessionEvent,
  SessionMeta,
} from "../shared/schema";

type ReportData = {
  meta: SessionMeta;
  events: SessionEvent[];
  endedAt: number;
};

type Screenshots = Record<string, string>;

// ------------------------- DOM helpers -------------------------

type Attrs = Record<string, string | number | boolean | undefined | null>;
type Child = string | number | Node | null | undefined | false;

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  children?: Child | Child[],
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") node.className = String(v);
      else if (v === true) node.setAttribute(k, "");
      else node.setAttribute(k, String(v));
    }
  }
  appendChildren(node, children);
  return node;
};

const svg = (tag: string, attrs?: Attrs, children?: Child | Child[]): SVGElement => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (v === true) node.setAttribute(k, "");
      else node.setAttribute(k, String(v));
    }
  }
  appendChildren(node, children);
  return node;
};

const appendChildren = (node: Node, children: Child | Child[] | undefined) => {
  if (children === undefined) return;
  const arr = Array.isArray(children) ? children : [children];
  for (const c of arr) {
    if (c === null || c === undefined || c === false) continue;
    if (typeof c === "string" || typeof c === "number") {
      node.appendChild(document.createTextNode(String(c)));
    } else {
      node.appendChild(c);
    }
  }
};

// ------------------------- Format helpers -------------------------

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

const fmtTime = (ms: number): string => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};

const fmtDate = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const fmtDuration = (ms: number): string => {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
};

const truncate = (s: string, max: number): string =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s;

// ------------------------- Data parsing -------------------------

const readJson = <T>(id: string, fallback: T): T => {
  const node = document.getElementById(id);
  if (!node || !node.textContent) return fallback;
  try {
    return JSON.parse(node.textContent) as T;
  } catch {
    return fallback;
  }
};

const isError = (e: SessionEvent): e is RuntimeErrorEvent | (ConsoleEvent & { level: "error" }) =>
  e.type === "error" || (e.type === "console" && e.level === "error");

const isConsoleEvent = (e: SessionEvent): e is ConsoleEvent => e.type === "console";
const isActionEvent = (
  e: SessionEvent,
): e is ClickEvent | FormInputEvent | FormSubmitEvent | NavEvent | PageEvent =>
  e.type === "click" || e.type === "input" || e.type === "submit" || e.type === "nav" || e.type === "page";

// ------------------------- Stats -------------------------

type Stats = {
  errors: number;
  warnings: number;
  actions: number;
  shots: number;
  navs: number;
  consoleAll: number;
  consoleError: number;
  consoleWarn: number;
  consoleLog: number;
  consoleInfo: number;
  consoleDebug: number;
  clicks: number;
  inputs: number;
  submits: number;
};

const computeStats = (events: SessionEvent[]): Stats => {
  const s: Stats = {
    errors: 0,
    warnings: 0,
    actions: 0,
    shots: 0,
    navs: 0,
    consoleAll: 0,
    consoleError: 0,
    consoleWarn: 0,
    consoleLog: 0,
    consoleInfo: 0,
    consoleDebug: 0,
    clicks: 0,
    inputs: 0,
    submits: 0,
  };
  for (const e of events) {
    switch (e.type) {
      case "click":
        s.clicks++;
        s.actions++;
        break;
      case "input":
        s.inputs++;
        s.actions++;
        break;
      case "submit":
        s.submits++;
        s.actions++;
        break;
      case "nav":
        s.navs++;
        s.actions++;
        break;
      case "screenshot":
        s.shots++;
        break;
      case "error":
        s.errors++;
        break;
      case "console":
        s.consoleAll++;
        if (e.level === "error") {
          s.consoleError++;
          s.errors++;
        } else if (e.level === "warn") {
          s.consoleWarn++;
          s.warnings++;
        } else if (e.level === "log") s.consoleLog++;
        else if (e.level === "info") s.consoleInfo++;
        else if (e.level === "debug") s.consoleDebug++;
        break;
      case "page":
        // page events count as a kind of nav too
        break;
    }
  }
  return s;
};

// ------------------------- Sparkline (errors over time) -------------------------

const renderSparkline = (
  events: SessionEvent[],
  startedAt: number,
  endedAt: number,
): SVGElement | null => {
  const errors = events.filter(isError);
  if (errors.length === 0) return null;

  const W = 140;
  const H = 36;
  const dur = Math.max(endedAt - startedAt, 1);

  const baselineY = H / 2;
  const tickH = 14;
  const children: SVGElement[] = [
    svg("line", {
      x1: 0,
      x2: W,
      y1: baselineY,
      y2: baselineY,
      stroke: "var(--border)",
      "stroke-width": "1",
    }),
  ];
  for (const e of errors) {
    const x = ((e.ts - startedAt) / dur) * W;
    children.push(
      svg("line", {
        x1: x.toFixed(1),
        x2: x.toFixed(1),
        y1: baselineY - tickH / 2,
        y2: baselineY + tickH / 2,
        stroke: "var(--danger)",
        "stroke-width": "1.5",
        "stroke-linecap": "round",
      }),
    );
  }
  return svg(
    "svg",
    { class: "summary-spark", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" },
    children,
  );
};

// ------------------------- Summary card -------------------------

const renderSummary = (data: ReportData, stats: Stats): HTMLElement => {
  const { meta, events } = data;
  const duration = data.endedAt - meta.startedAt;
  const firstPage = events.find((e): e is PageEvent => e.type === "page");
  const url = firstPage?.url ?? "(no page captured)";

  const env: string[] = [];
  if (firstPage) {
    const ua = firstPage.userAgent;
    const browser = /Edg/.test(ua) ? "Edge" : /Chrome/.test(ua) ? "Chrome" : /Firefox/.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "Browser";
    env.push(browser);
    env.push(firstPage.platform || "Unknown OS");
    env.push(`${firstPage.viewport.w}×${firstPage.viewport.h}`);
    env.push(firstPage.language);
    env.push(firstPage.timezone);
  }

  const sevClass = `severity ${meta.severity}`;
  const titleText = meta.title.trim() || "(untitled session)";

  const themeBtn = el("button", { class: "theme-toggle", id: "theme-toggle", type: "button" }, "☾ Dark");

  return el("header", { class: "summary" }, [
    el("div", { class: "summary-main" }, [
      el("h1", { class: "summary-title" }, [
        titleText,
        el("span", { class: sevClass }, meta.severity),
      ]),
      el("div", { class: "summary-meta" }, [
        truncate(url, 80),
        " · ",
        fmtDate(meta.startedAt),
        " · ",
        fmtDuration(duration),
        firstPage ? " · " : null,
        firstPage ? env.join(" · ") : null,
      ]),
      el("div", { class: "summary-stats" }, [
        el("span", { class: "stat errors" }, [
          el("span", { class: "stat-num" }, String(stats.errors)),
          " errors",
        ]),
        el("span", { class: "stat warnings" }, [
          el("span", { class: "stat-num" }, String(stats.warnings)),
          " warnings",
        ]),
        el("span", { class: "stat" }, [
          el("span", { class: "stat-num" }, String(stats.actions)),
          " actions",
        ]),
        el("span", { class: "stat" }, [
          el("span", { class: "stat-num" }, String(stats.shots)),
          " screenshots",
        ]),
        el("span", { class: "stat" }, [
          el("span", { class: "stat-num" }, String(stats.navs)),
          " navs",
        ]),
      ]),
    ]),
    renderSparkline(events, meta.startedAt, data.endedAt) as Node | null,
    themeBtn,
  ]);
};

// ------------------------- Sidebar -------------------------

const SECTIONS: { id: string; label: string }[] = [
  { id: "repro", label: "Repro Steps" },
  { id: "timeline", label: "Timeline" },
  { id: "console", label: "Console" },
  { id: "actions", label: "Actions" },
  { id: "screenshots", label: "Screenshots" },
  { id: "notes", label: "Notes" },
  { id: "raw", label: "Raw JSON" },
];

const renderSidebar = (): HTMLElement =>
  el(
    "nav",
    { class: "sidebar" },
    SECTIONS.map((s) => el("a", { href: `#${s.id}`, "data-target": s.id }, s.label)),
  );

// ------------------------- Repro Steps -------------------------

const describeAction = (e: ClickEvent | FormInputEvent | FormSubmitEvent | NavEvent | PageEvent): {
  tag: string;
  tagClass: string;
  main: HTMLElement;
} => {
  switch (e.type) {
    case "page":
      return {
        tag: "Page",
        tagClass: "tag-page",
        main: el("span", {}, [
          "Loaded ",
          el("span", { class: "step-detail" }, truncate(e.url, 80)),
        ]),
      };
    case "nav":
      return {
        tag: "Nav",
        tagClass: "tag-nav",
        main: el("span", {}, [
          `${e.kind} → `,
          el("span", { class: "step-detail" }, truncate(e.url, 80)),
        ]),
      };
    case "click":
      return {
        tag: "Click",
        tagClass: "tag-click",
        main: el("span", {}, [
          e.text ? `"${truncate(e.text, 50)}"` : "(no text)",
          " on ",
          el("span", { class: "step-detail" }, truncate(e.selector, 60)),
        ]),
      };
    case "input": {
      const label = e.redacted
        ? "redacted input"
        : e.length === 0
          ? "cleared"
          : `typed ${e.length} char${e.length === 1 ? "" : "s"}`;
      return {
        tag: "Input",
        tagClass: "tag-input",
        main: el("span", {}, [
          label + " in ",
          el("span", { class: "step-detail" }, truncate(e.selector, 60)),
          ` (${e.inputType})`,
        ]),
      };
    }
    case "submit":
      return {
        tag: "Submit",
        tagClass: "tag-submit",
        main: el("span", {}, [
          "Submitted ",
          el("span", { class: "step-detail" }, truncate(e.selector, 60)),
        ]),
      };
  }
};

const renderRepro = (data: ReportData, screenshots: Screenshots, openLightbox: (id: string) => void): HTMLElement => {
  const events = data.events;
  const items: HTMLElement[] = [];
  let i = 0;
  while (i < events.length) {
    const e = events[i]!;
    if (!isActionEvent(e)) {
      i++;
      continue;
    }
    const desc = describeAction(e);
    const followups: Child[] = [];
    let j = i + 1;
    while (j < events.length && !isActionEvent(events[j]!)) {
      const f = events[j]!;
      if (isError(f)) {
        const msg = f.type === "error" ? f.message : f.message;
        followups.push(el("div", { class: "step-error" }, truncate(msg, 200)));
      } else if (f.type === "screenshot") {
        const dataUrl = screenshots[f.id];
        if (dataUrl) {
          const img = el("img", { src: dataUrl, alt: "screenshot", "data-shot-id": f.id });
          img.addEventListener("click", () => openLightbox(f.id));
          followups.push(
            el("div", { class: "step-shot" }, [
              img,
              `${f.kind} screenshot · ${fmtTime(f.ts)}`,
            ]),
          );
        } else {
          followups.push(
            el("div", { class: "step-shot" }, [
              `📷 ${f.kind} screenshot · ${fmtTime(f.ts)} (image not embedded)`,
            ]),
          );
        }
      }
      j++;
    }
    items.push(
      el("li", { class: "repro-step" }, [
        el("div", { class: "step-main" }, [
          el("span", { class: `step-tag ${desc.tagClass}` }, desc.tag),
          desc.main,
        ]),
        followups.length > 0 ? el("div", { class: "step-followup" }, followups) : null,
      ]),
    );
    i = j;
  }
  if (items.length === 0) {
    return el("div", { class: "card empty" }, "No user actions recorded.");
  }
  return el("ol", { class: "repro" }, items);
};

// ------------------------- Timeline -------------------------

const TIMELINE_LANES: { key: string; label: string; color: string; match: (e: SessionEvent) => boolean }[] = [
  { key: "shots", label: "Screenshots", color: "var(--warn)", match: (e) => e.type === "screenshot" },
  { key: "errors", label: "Errors", color: "var(--danger)", match: (e) => isError(e) },
  { key: "actions", label: "Actions", color: "var(--info)", match: (e) =>
    e.type === "click" || e.type === "input" || e.type === "submit" || e.type === "nav" || e.type === "page" },
  { key: "console", label: "Console", color: "var(--muted)", match: (e) => isConsoleEvent(e) && e.level !== "error" && e.level !== "warn" },
];

const describeForTooltip = (e: SessionEvent): string => {
  const t = fmtTime(e.ts);
  switch (e.type) {
    case "console":
      return `${t} · console.${e.level}: ${truncate(e.message, 80)}`;
    case "error":
      return `${t} · error: ${truncate(e.message, 80)}`;
    case "click":
      return `${t} · click ${truncate(e.selector, 60)}`;
    case "input":
      return `${t} · input ${truncate(e.selector, 60)}`;
    case "submit":
      return `${t} · submit ${truncate(e.selector, 60)}`;
    case "nav":
      return `${t} · ${e.kind} ${truncate(e.url, 60)}`;
    case "page":
      return `${t} · page ${truncate(e.url, 60)}`;
    case "screenshot":
      return `${t} · ${e.kind} screenshot`;
  }
};

const renderTimeline = (data: ReportData): HTMLElement => {
  const { meta, events, endedAt } = data;
  const W = 1200;
  const H = 100;
  const padX = 16;
  const padTop = 12;
  const padBot = 12;
  const innerW = W - 2 * padX;
  const innerH = H - padTop - padBot;
  const laneH = innerH / TIMELINE_LANES.length;
  const dur = Math.max(endedAt - meta.startedAt, 1);

  const xFor = (ts: number) => padX + ((ts - meta.startedAt) / dur) * innerW;

  const children: SVGElement[] = [];

  // Lane backgrounds + labels
  TIMELINE_LANES.forEach((lane, idx) => {
    const y = padTop + idx * laneH;
    children.push(
      svg("line", {
        x1: padX,
        x2: W - padX,
        y1: y + laneH / 2,
        y2: y + laneH / 2,
        stroke: "var(--border)",
        "stroke-width": "1",
      }),
    );
    children.push(
      svg("text", {
        x: padX,
        y: y + laneH / 2 - 6,
        "font-size": "10",
        fill: "var(--muted)",
      }, lane.label),
    );
  });

  // Dots
  for (const e of events) {
    const laneIdx = TIMELINE_LANES.findIndex((l) => l.match(e));
    if (laneIdx < 0) continue;
    const lane = TIMELINE_LANES[laneIdx]!;
    const cx = xFor(e.ts);
    const cy = padTop + laneIdx * laneH + laneH / 2;
    const dot = svg("circle", {
      cx,
      cy,
      r: 4,
      fill: lane.color,
      stroke: "var(--bg)",
      "stroke-width": "1.5",
    });
    const titleText = describeForTooltip(e);
    dot.appendChild(svg("title", {}, titleText));
    children.push(dot);
  }

  const svgRoot = svg("svg", {
    class: "timeline-svg",
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: "none",
  }, children);

  const legend = el("div", { class: "timeline-legend" },
    TIMELINE_LANES.map((l) =>
      el("span", {}, [
        el("span", { class: "legend-dot", style: `background:${l.color}` }),
        l.label,
      ]),
    ),
  );

  return el("div", { class: "timeline-wrap" }, [svgRoot, legend]);
};

// ------------------------- Console -------------------------

const consoleLevelClass = (level: ConsoleEvent["level"]): string => `level-pill level-${level}`;

const renderConsole = (data: ReportData, stats: Stats): HTMLElement => {
  const consoleEvents = data.events.filter(isConsoleEvent);
  const errorEvents = data.events.filter(
    (e): e is RuntimeErrorEvent => e.type === "error",
  );

  type ConsoleRow =
    | { kind: "console"; e: ConsoleEvent }
    | { kind: "runtime"; e: RuntimeErrorEvent };

  const rows: ConsoleRow[] = [
    ...consoleEvents.map((e): ConsoleRow => ({ kind: "console", e })),
    ...errorEvents.map((e): ConsoleRow => ({ kind: "runtime", e })),
  ].sort((a, b) => a.e.ts - b.e.ts);

  if (rows.length === 0) {
    return el("div", { class: "card empty" }, "No console output captured.");
  }

  const filters: { key: "all" | "error" | "warn" | "log"; label: string; count: number }[] = [
    { key: "all", label: "All", count: rows.length },
    { key: "error", label: "Errors", count: stats.errors },
    { key: "warn", label: "Warnings", count: stats.consoleWarn },
    { key: "log", label: "Logs", count: stats.consoleAll - stats.consoleError - stats.consoleWarn },
  ];

  let active: "all" | "error" | "warn" | "log" = "all";

  const tbody = el("tbody");
  const renderRows = () => {
    tbody.replaceChildren();
    for (const row of rows) {
      const level: string = row.kind === "runtime" ? "error" : row.e.level;
      if (active === "error" && level !== "error") continue;
      if (active === "warn" && level !== "warn") continue;
      if (active === "log" && (level === "error" || level === "warn")) continue;

      const stack = row.e.type === "error"
        ? row.e.stack
        : undefined;
      const source = row.e.type === "error"
        ? row.e.source
        : undefined;

      const msgCell = el("td", { class: "col-msg" }, [
        row.e.message,
        stack
          ? el("details", { class: "stack-toggle" }, [
              el("summary", {}, "stack"),
              el("pre", { class: "stack" }, stack),
            ])
          : null,
      ]);

      tbody.appendChild(
        el("tr", {}, [
          el("td", { class: "col-time" }, fmtTime(row.e.ts)),
          el("td", { class: "col-level" }, [el("span", { class: consoleLevelClass(level as ConsoleEvent["level"]) }, level)]),
          msgCell,
          el("td", { class: "col-detail" }, source ?? ""),
        ]),
      );
    }
  };
  renderRows();

  const pillEls = filters.map((f) => {
    const p = el(
      "button",
      { class: "pill" + (f.key === active ? " active" : ""), type: "button", "data-key": f.key },
      `${f.label} ${f.count}`,
    );
    p.addEventListener("click", () => {
      active = f.key;
      pillEls.forEach((pe) => pe.classList.remove("active"));
      p.classList.add("active");
      renderRows();
    });
    return p;
  });

  return el("div", {}, [
    el("div", { class: "filters" }, pillEls),
    el("div", { class: "table-wrap" }, [
      el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, "Time"),
            el("th", {}, "Level"),
            el("th", {}, "Message"),
            el("th", {}, "Source"),
          ]),
        ]),
        tbody,
      ]),
    ]),
  ]);
};

// ------------------------- Actions -------------------------

const renderDonut = (parts: { label: string; value: number; color: string }[]): SVGElement => {
  const r = 36;
  const c = 2 * Math.PI * r;
  const total = parts.reduce((acc, p) => acc + p.value, 0);
  const children: SVGElement[] = [
    svg("circle", {
      cx: 50, cy: 50, r,
      fill: "none",
      stroke: "var(--border)",
      "stroke-width": "12",
    }),
  ];
  if (total > 0) {
    let offset = 0;
    for (const p of parts) {
      const len = (p.value / total) * c;
      children.push(
        svg("circle", {
          cx: 50, cy: 50, r,
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
  return svg("svg", { class: "donut", viewBox: "0 0 100 100" }, children);
};

const renderActions = (data: ReportData, stats: Stats): HTMLElement => {
  const actions = data.events.filter(
    (e): e is ClickEvent | FormInputEvent | FormSubmitEvent | NavEvent =>
      e.type === "click" || e.type === "input" || e.type === "submit" || e.type === "nav",
  );

  if (actions.length === 0) {
    return el("div", { class: "card empty" }, "No user actions recorded.");
  }

  const donutParts = [
    { label: "Clicks", value: stats.clicks, color: "var(--info)" },
    { label: "Inputs", value: stats.inputs, color: "var(--ok)" },
    { label: "Submits", value: stats.submits, color: "var(--purple)" },
    { label: "Navs", value: stats.navs, color: "var(--muted)" },
  ];

  const head = el("div", { class: "actions-head" }, [
    renderDonut(donutParts),
    el("div", { class: "donut-legend" },
      donutParts.map((p) =>
        el("div", { class: "donut-legend-row" }, [
          el("span", { class: "legend-dot", style: `background:${p.color}` }),
          `${p.label}: `,
          el("strong", {}, String(p.value)),
        ]),
      ),
    ),
  ]);

  const tbody = el(
    "tbody",
    {},
    actions.map((e) => {
      let typeLabel: string = e.type;
      let detail = "";
      if (e.type === "click") detail = e.text ? `"${truncate(e.text, 60)}"` : (e.href ?? "");
      else if (e.type === "input") detail = e.redacted ? `redacted (${e.inputType})` : `length=${e.length} (${e.inputType})`;
      else if (e.type === "submit") detail = "";
      else if (e.type === "nav") {
        typeLabel = `nav (${e.kind})`;
        detail = truncate(e.url, 80);
      }
      return el("tr", {}, [
        el("td", { class: "col-time" }, fmtTime(e.ts)),
        el("td", { class: "col-type" }, typeLabel),
        el("td", { class: "col-selector" }, "selector" in e ? truncate(e.selector, 80) : ""),
        el("td", { class: "col-detail" }, detail),
      ]);
    }),
  );

  return el("div", {}, [
    head,
    el("div", { class: "table-wrap" }, [
      el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, "Time"),
            el("th", {}, "Type"),
            el("th", {}, "Selector"),
            el("th", {}, "Detail"),
          ]),
        ]),
        tbody,
      ]),
    ]),
  ]);
};

// ------------------------- Screenshots -------------------------

const renderScreenshots = (
  data: ReportData,
  screenshots: Screenshots,
  openLightbox: (id: string) => void,
): HTMLElement => {
  const shots = data.events.filter((e): e is ScreenshotEvent => e.type === "screenshot");
  if (shots.length === 0) {
    return el("div", { class: "card empty" }, "No screenshots taken.");
  }
  const cards = shots.map((s) => {
    const dataUrl = screenshots[s.id];
    const card = el("div", { class: "shot-card" }, [
      dataUrl
        ? el("img", { src: dataUrl, alt: `screenshot ${s.id}` })
        : el("div", { class: "shot-meta" }, "(image not embedded)"),
      el("div", { class: "shot-meta" }, [
        el("span", { class: `shot-kind ${s.kind}` }, s.kind),
        fmtTime(s.ts),
      ]),
    ]);
    if (dataUrl) card.addEventListener("click", () => openLightbox(s.id));
    return card;
  });
  return el("div", { class: "shots-grid" }, cards);
};

// ------------------------- Notes -------------------------

const renderNotes = (data: ReportData): HTMLElement => {
  const notes = data.meta.notes.trim();
  if (!notes) return el("div", { class: "card empty" }, "No notes provided.");
  return el("div", { class: "card" }, [el("p", { class: "notes-pre" }, notes)]);
};

// ------------------------- Raw -------------------------

const renderRaw = (data: ReportData, screenshots: Screenshots): HTMLElement => {
  const summary: unknown = {
    meta: data.meta,
    endedAt: data.endedAt,
    eventsCount: data.events.length,
    screenshotsEmbedded: Object.keys(screenshots).length,
    events: data.events,
  };
  return el("details", {}, [
    el("summary", { class: "mono", style: "cursor:pointer;color:var(--muted);font-size:12px" }, "Show raw JSON"),
    el("pre", { class: "raw-pre mono" }, JSON.stringify(summary, null, 2)),
  ]);
};

// ------------------------- Lightbox -------------------------

const setupLightbox = (screenshots: Screenshots) => {
  let backdrop: HTMLElement | null = null;
  return (id: string) => {
    const url = screenshots[id];
    if (!url) return;
    backdrop = el("div", { class: "lightbox" }, [el("img", { src: url, alt: "screenshot" })]);
    backdrop.addEventListener("click", () => {
      backdrop?.remove();
      backdrop = null;
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        backdrop?.remove();
        backdrop = null;
        document.removeEventListener("keydown", onKey);
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.appendChild(backdrop);
  };
};

// ------------------------- Theme -------------------------

const setupTheme = () => {
  const saved = localStorage.getItem("wr.theme");
  if (saved === "dark") document.documentElement.setAttribute("data-theme", "dark");
  const apply = () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const btn = document.getElementById("theme-toggle");
    if (btn) btn.textContent = isDark ? "☀ Light" : "☾ Dark";
  };
  apply();
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.id !== "theme-toggle") return;
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    if (next === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("wr.theme", next);
    apply();
  });
};

// ------------------------- Sidebar active highlighting -------------------------

const setupActiveSection = () => {
  const links = new Map<string, HTMLAnchorElement>();
  document.querySelectorAll<HTMLAnchorElement>("nav.sidebar a[data-target]").forEach((a) => {
    const t = a.getAttribute("data-target");
    if (t) links.set(t, a);
  });
  const sections = Array.from(document.querySelectorAll<HTMLElement>("section[id]"));
  if (sections.length === 0) return;

  const update = () => {
    const offset = 120;
    let active = sections[0]!.id;
    for (const s of sections) {
      if (s.getBoundingClientRect().top - offset <= 0) {
        active = s.id;
      } else {
        break;
      }
    }
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

// ------------------------- Empty state -------------------------

const renderEmpty = (): HTMLElement =>
  el("div", { style: "padding:40px;text-align:center;color:var(--muted)" }, [
    el("h1", {}, "No session data"),
    el("p", {}, "Open the Web Reporter extension, record a session, and export it to populate this report."),
  ]);

// ------------------------- Bootstrap -------------------------

const bootstrap = () => {
  const raw = readJson<{ meta?: SessionMeta; events?: SessionEvent[]; endedAt?: number }>(
    "wr-session",
    {},
  );
  const screenshots = readJson<Screenshots>("wr-screenshots", {});

  const app = document.getElementById("app");
  if (!app) return;

  if (!raw.meta) {
    app.appendChild(renderEmpty());
    return;
  }

  const events = raw.events ?? [];
  const data: ReportData = {
    meta: raw.meta,
    events,
    endedAt:
      raw.endedAt ?? (events.length > 0 ? events[events.length - 1]!.ts : raw.meta.startedAt),
  };

  const stats = computeStats(data.events);
  const openLightbox = setupLightbox(screenshots);

  app.appendChild(renderSummary(data, stats));
  app.appendChild(renderSidebar());

  const main = el("main", {}, [
    el("section", { id: "repro" }, [
      el("h2", { class: "section-h" }, "Repro Steps"),
      renderRepro(data, screenshots, openLightbox),
    ]),
    el("section", { id: "timeline" }, [
      el("h2", { class: "section-h" }, "Timeline"),
      renderTimeline(data),
    ]),
    el("section", { id: "console" }, [
      el("h2", { class: "section-h" }, "Console"),
      renderConsole(data, stats),
    ]),
    el("section", { id: "actions" }, [
      el("h2", { class: "section-h" }, "Actions"),
      renderActions(data, stats),
    ]),
    el("section", { id: "screenshots" }, [
      el("h2", { class: "section-h" }, "Screenshots"),
      renderScreenshots(data, screenshots, openLightbox),
    ]),
    el("section", { id: "notes" }, [
      el("h2", { class: "section-h" }, "Notes"),
      renderNotes(data),
    ]),
    el("section", { id: "raw" }, [
      el("h2", { class: "section-h" }, "Raw JSON"),
      renderRaw(data, screenshots),
    ]),
  ]);
  app.appendChild(main);

  setupTheme();
  setupActiveSection();
};

bootstrap();
