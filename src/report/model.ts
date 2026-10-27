/**
 * Pure, DOM-free helpers for the report viewer. Everything here is unit-testable in Node.
 */
import {
  isActionEvent,
  isErrorEvent,
  isFailedRequest,
  type ActionEvent,
  type ConsoleEvent,
  type NetworkEvent,
  type PageEvent,
  type RuntimeErrorEvent,
  type ScreenshotEvent,
  type SessionEvent,
  type SessionMeta,
} from "../shared/schema";

export { isActionEvent, isErrorEvent, isFailedRequest };

export type ReportData = {
  meta: SessionMeta;
  events: SessionEvent[];
  endedAt: number;
};

export type Screenshots = Record<string, string>;

// ------------------------- formatting -------------------------

export const pad = (n: number, w = 2): string => String(n).padStart(w, "0");

export const fmtTime = (ms: number): string => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};

export const fmtClock = (ms: number): string => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

export const fmtDate = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const fmtIso = (ms: number): string => new Date(ms).toISOString();

export const fmtDuration = (ms: number): string => {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  if (totalSec === 0 && ms > 0) return `${ms} ms`;
  return `${s}s`;
};

/** Offset from session start as `m:ss.t` (tenths), e.g. `0:05.2`, `12:03.0`. */
export const fmtRel = (ts: number, startedAt: number): string => {
  const ms = Math.max(0, ts - startedAt);
  const totalTenths = Math.floor(ms / 100);
  const m = Math.floor(totalTenths / 600);
  const s = Math.floor((totalTenths % 600) / 10);
  const t = totalTenths % 10;
  return `${m}:${pad(s)}.${t}`;
};

/** Short axis label for a millisecond offset: `0s`, `30s`, `1m`, `1m30s`. */
export const fmtOffset = (ms: number): string => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m}m` : `${m}m${pad(r)}s`;
};

export const fmtSize = (n: number | undefined): string => {
  if (n === undefined || Number.isNaN(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

export const fmtMs = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${n} ms`);

export const truncate = (s: string, max: number): string =>
  s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;

/** `host/path?query` without scheme; trimmed from the middle so both ends stay readable. */
export const shortUrl = (url: string, max = 80): string => {
  let s = url;
  try {
    const u = new URL(url);
    s = `${u.host}${u.pathname}${u.search}${u.hash}`;
    if (s.endsWith("/") && u.pathname === "/" && !u.search && !u.hash) s = u.host;
  } catch {
    // keep as-is
  }
  if (s.length <= max) return s;
  const head = Math.ceil((max - 1) * 0.6);
  const tail = max - 1 - head;
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`;
};

export const pathOf = (url: string): string => {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
};

export const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};

// ------------------------- data prep -------------------------

/** Stable sort by timestamp; ties keep insertion order. */
export const normalizeEvents = (events: SessionEvent[]): SessionEvent[] =>
  events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.ts - b.e.ts || a.i - b.i)
    .map((x) => x.e);

export const sessionDuration = (data: ReportData): number =>
  Math.max(0, data.endedAt - data.meta.startedAt);

// ------------------------- user agent -------------------------

export type Environment = {
  browser: string;
  browserVersion: string;
  os: string;
  device: "desktop" | "mobile" | "tablet";
};

export const parseUserAgent = (ua: string, platform = ""): Environment => {
  const pick = (re: RegExp): string | undefined => {
    const m = ua.match(re);
    return m?.[1];
  };

  let browser = "Browser";
  let browserVersion = "";
  if (/Edg\//.test(ua)) {
    browser = "Edge";
    browserVersion = pick(/Edg\/([\d.]+)/) ?? "";
  } else if (/OPR\//.test(ua)) {
    browser = "Opera";
    browserVersion = pick(/OPR\/([\d.]+)/) ?? "";
  } else if (/Brave/.test(ua)) {
    browser = "Brave";
    browserVersion = pick(/Chrome\/([\d.]+)/) ?? "";
  } else if (/Chrome\//.test(ua)) {
    browser = "Chrome";
    browserVersion = pick(/Chrome\/([\d.]+)/) ?? "";
  } else if (/Firefox\//.test(ua)) {
    browser = "Firefox";
    browserVersion = pick(/Firefox\/([\d.]+)/) ?? "";
  } else if (/Safari\//.test(ua) && /Version\//.test(ua)) {
    browser = "Safari";
    browserVersion = pick(/Version\/([\d.]+)/) ?? "";
  }
  browserVersion = browserVersion.split(".").slice(0, 2).join(".");

  let os = "Unknown OS";
  if (/Windows NT 10/.test(ua)) os = "Windows 10/11";
  else if (/Windows NT 6\.3/.test(ua)) os = "Windows 8.1";
  else if (/Windows NT 6\.1/.test(ua)) os = "Windows 7";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/iPhone|iPad|iPod/.test(ua)) {
    const v = pick(/OS (\d+[._]\d+)/)?.replace("_", ".");
    os = `iOS${v ? ` ${v}` : ""}`;
  } else if (/Mac OS X/.test(ua)) {
    const v = pick(/Mac OS X (\d+[._]\d+)/)?.replace("_", ".");
    os = `macOS${v ? ` ${v}` : ""}`;
  } else if (/Android/.test(ua)) {
    const v = pick(/Android ([\d.]+)/);
    os = `Android${v ? ` ${v}` : ""}`;
  } else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Linux/.test(ua)) os = "Linux";
  else if (platform) os = platform;

  const device: Environment["device"] = /iPad|Tablet/.test(ua)
    ? "tablet"
    : /Mobi|iPhone|Android/.test(ua)
      ? "mobile"
      : "desktop";

  return { browser, browserVersion, os, device };
};

// ------------------------- stats -------------------------

export type Stats = {
  errors: number;
  runtimeErrors: number;
  warnings: number;
  actions: number;
  clicks: number;
  inputs: number;
  submits: number;
  keys: number;
  navs: number;
  pages: number;
  notes: number;
  shots: number;
  consoleAll: number;
  consoleError: number;
  consoleWarn: number;
  consoleInfo: number;
  consoleLog: number;
  consoleDebug: number;
  network: number;
  netOk: number;
  net3xx: number;
  net4xx: number;
  net5xx: number;
  netFail: number;
  netBytes: number;
  netMaxDuration: number;
};

export const computeStats = (events: SessionEvent[]): Stats => {
  const s: Stats = {
    errors: 0,
    runtimeErrors: 0,
    warnings: 0,
    actions: 0,
    clicks: 0,
    inputs: 0,
    submits: 0,
    keys: 0,
    navs: 0,
    pages: 0,
    notes: 0,
    shots: 0,
    consoleAll: 0,
    consoleError: 0,
    consoleWarn: 0,
    consoleInfo: 0,
    consoleLog: 0,
    consoleDebug: 0,
    network: 0,
    netOk: 0,
    net3xx: 0,
    net4xx: 0,
    net5xx: 0,
    netFail: 0,
    netBytes: 0,
    netMaxDuration: 0,
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
      case "key":
        s.keys++;
        s.actions++;
        break;
      case "nav":
        s.navs++;
        s.actions++;
        break;
      case "page":
        s.pages++;
        break;
      case "note":
        s.notes++;
        break;
      case "screenshot":
        s.shots++;
        break;
      case "error":
        s.errors++;
        s.runtimeErrors++;
        break;
      case "console":
        s.consoleAll++;
        if (e.level === "error") {
          s.consoleError++;
          s.errors++;
        } else if (e.level === "warn") {
          s.consoleWarn++;
          s.warnings++;
        } else if (e.level === "info") s.consoleInfo++;
        else if (e.level === "debug") s.consoleDebug++;
        else s.consoleLog++;
        break;
      case "network":
        s.network++;
        if (e.status === 0) s.netFail++;
        else if (e.status < 300) s.netOk++;
        else if (e.status < 400) s.net3xx++;
        else if (e.status < 500) s.net4xx++;
        else s.net5xx++;
        if (e.size) s.netBytes += e.size;
        if (e.duration > s.netMaxDuration) s.netMaxDuration = e.duration;
        break;
    }
  }
  return s;
};

// ------------------------- repro steps -------------------------

export type Indexed<T extends SessionEvent = SessionEvent> = { index: number; event: T };

export type Step = {
  index: number;
  event: ActionEvent;
  /** Errors, failed requests, screenshots that happened after this step and before the next. */
  followups: Indexed[];
};

const isFollowup = (e: SessionEvent): boolean =>
  isErrorEvent(e) || isFailedRequest(e) || e.type === "screenshot";

/**
 * Group the event stream into user steps with attached consequences.
 * Followups that happen before the first action are attached to a synthetic leading step
 * only if there is at least one action; otherwise they are dropped (nothing to attach to).
 */
export const buildSteps = (events: SessionEvent[]): Step[] => {
  const steps: Step[] = [];
  let current: Step | null = null;
  const orphans: Indexed[] = [];

  events.forEach((event, index) => {
    if (isActionEvent(event)) {
      current = { index, event, followups: [] };
      steps.push(current);
      return;
    }
    if (!isFollowup(event)) return;
    if (current) current.followups.push({ index, event });
    else orphans.push({ index, event });
  });

  if (orphans.length > 0 && steps.length > 0) {
    steps[0]!.followups.unshift(...orphans);
  }
  return steps;
};

/** Collapse runs of identical input events on the same field (typing often fires several `change`s). */
export const dedupeSteps = (steps: Step[]): Step[] => {
  const out: Step[] = [];
  for (const s of steps) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.followups.length === 0 &&
      prev.event.type === "input" &&
      s.event.type === "input" &&
      prev.event.selector === s.event.selector
    ) {
      out[out.length - 1] = s; // keep the latest (final length)
      continue;
    }
    out.push(s);
  }
  return out;
};

// ------------------------- error grouping -------------------------

export type ErrorGroup = {
  key: string;
  message: string;
  kind: "runtime" | "console";
  count: number;
  firstTs: number;
  firstIndex: number;
  source?: string;
};

const normalizeErrorMessage = (m: string): string =>
  m
    .replace(/\s+/g, " ")
    .replace(/\b\d{3,}\b/g, "N") // ids, timestamps
    .replace(/https?:\/\/\S+/g, "URL")
    .trim()
    .slice(0, 300);

export const groupErrors = (events: SessionEvent[]): ErrorGroup[] => {
  const map = new Map<string, ErrorGroup>();
  events.forEach((e, index) => {
    if (!isErrorEvent(e)) return;
    const kind: ErrorGroup["kind"] = e.type === "error" ? "runtime" : "console";
    const key = `${kind}:${normalizeErrorMessage(e.message)}`;
    const existing = map.get(key);
    if (existing) {
      existing.count++;
      return;
    }
    map.set(key, {
      key,
      message: e.message,
      kind,
      count: 1,
      firstTs: e.ts,
      firstIndex: index,
      source: e.type === "error" ? e.source : undefined,
    });
  });
  return Array.from(map.values()).sort((a, b) => b.count - a.count || a.firstTs - b.firstTs);
};

export const failedRequests = (events: SessionEvent[]): Indexed<NetworkEvent>[] => {
  const out: Indexed<NetworkEvent>[] = [];
  events.forEach((event, index) => {
    if (isFailedRequest(event)) out.push({ index, event });
  });
  return out;
};

export const uniquePages = (events: SessionEvent[]): string[] => {
  const seen = new Set<string>();
  for (const e of events) {
    if (e.type === "page" || e.type === "nav") seen.add(e.url);
  }
  return Array.from(seen);
};

export const firstPage = (events: SessionEvent[]): PageEvent | undefined =>
  events.find((e): e is PageEvent => e.type === "page");

export const screenshotsOf = (events: SessionEvent[]): Indexed<ScreenshotEvent>[] => {
  const out: Indexed<ScreenshotEvent>[] = [];
  events.forEach((event, index) => {
    if (event.type === "screenshot") out.push({ index, event });
  });
  return out;
};

// ------------------------- console grouping -------------------------

export type ConsoleRow = {
  index: number;
  event: ConsoleEvent | RuntimeErrorEvent;
  level: ConsoleEvent["level"];
  isRuntime: boolean;
  /** Number of consecutive identical messages collapsed into this row. */
  repeat: number;
};

export const consoleRows = (events: SessionEvent[]): ConsoleRow[] => {
  const rows: ConsoleRow[] = [];
  events.forEach((event, index) => {
    if (event.type !== "console" && event.type !== "error") return;
    const isRuntime = event.type === "error";
    const level: ConsoleEvent["level"] = isRuntime ? "error" : event.level;
    const prev = rows[rows.length - 1];
    if (prev && prev.level === level && prev.isRuntime === isRuntime && prev.event.message === event.message) {
      prev.repeat++;
      return;
    }
    rows.push({ index, event, level, isRuntime, repeat: 1 });
  });
  return rows;
};

// ------------------------- misc -------------------------

export const statusBucket = (status: number): "fail" | "ok" | "redirect" | "client" | "server" => {
  if (status === 0) return "fail";
  if (status < 300) return "ok";
  if (status < 400) return "redirect";
  if (status < 500) return "client";
  return "server";
};

/** Pick a "nice" tick interval (ms) producing roughly `target` ticks over `durationMs`. */
export const niceTickInterval = (durationMs: number, target = 8): number => {
  const candidates = [
    100, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 900000,
    1800000, 3600000,
  ];
  const ideal = durationMs / target;
  for (const c of candidates) if (c >= ideal) return c;
  return candidates[candidates.length - 1]!;
};

export const describeKey = (key: string): string => key.replace("Arrow", "");
