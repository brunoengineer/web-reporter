export type Severity = "low" | "medium" | "high" | "critical";

export const SEVERITIES: readonly Severity[] = ["low", "medium", "high", "critical"];

export type SessionState = "idle" | "recording" | "exporting";

/** The browser tab a session is bound to. Events from other tabs are ignored. */
export type SessionTab = {
  id: number;
  windowId: number;
  url: string;
  title: string;
  /** Set when the tab is closed mid-session. */
  closed?: boolean;
};

export type SessionMeta = {
  id: string;
  state: SessionState;
  startedAt: number;
  title: string;
  severity: Severity;
  notes: string;
  tab: SessionTab | null;
  /** Version of the extension that produced the session. */
  appVersion: string;
};

/** Incrementally-maintained counters so the popup never has to load every event. */
export type SessionStats = {
  events: number;
  /** Approximate JSON bytes of all events. */
  bytes: number;
  /** Bytes of screenshot data URLs. */
  shotBytes: number;
  actions: number;
  errors: number;
  warnings: number;
  requests: number;
  failedRequests: number;
  shots: number;
  notes: number;
  /** Events dropped because the maxEvents limit was reached. */
  dropped: number;
};

export const emptyStats = (): SessionStats => ({
  events: 0,
  bytes: 0,
  shotBytes: 0,
  actions: 0,
  errors: 0,
  warnings: 0,
  requests: 0,
  failedRequests: 0,
  shots: 0,
  notes: 0,
  dropped: 0,
});

export type PageEvent = {
  type: "page";
  ts: number;
  url: string;
  title: string;
  referrer?: string;
  userAgent: string;
  viewport: { w: number; h: number };
  screen: { w: number; h: number };
  dpr?: number;
  language: string;
  timezone: string;
  platform: string;
  online?: boolean;
};

export type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug";

export type ConsoleEvent = {
  type: "console";
  ts: number;
  level: ConsoleLevel;
  message: string;
};

export type RuntimeErrorEvent = {
  type: "error";
  ts: number;
  message: string;
  stack?: string;
  source?: string;
};

export type ClickEvent = {
  type: "click";
  ts: number;
  selector: string;
  tag: string;
  text?: string;
  href?: string;
};

export type FormInputEvent = {
  type: "input";
  ts: number;
  selector: string;
  inputType: string;
  length: number;
  redacted: boolean;
};

export type FormSubmitEvent = {
  type: "submit";
  ts: number;
  selector: string;
};

/** Special keys only (Enter, Escape, Tab, arrows, shortcuts) — never printable characters. */
export type KeyEvent = {
  type: "key";
  ts: number;
  key: string;
  selector: string;
};

export type NavEvent = {
  type: "nav";
  ts: number;
  url: string;
  kind: "pushstate" | "replacestate" | "popstate" | "hashchange";
};

export type ScreenshotEvent = {
  type: "screenshot";
  ts: number;
  id: string;
  kind: "manual" | "auto";
  triggerTs?: number;
  url?: string;
  title?: string;
};

/** A timestamped note the QA added during the session ("marker"). */
export type NoteEvent = {
  type: "note";
  ts: number;
  text: string;
};

export type NetworkEvent = {
  type: "network";
  ts: number;
  method: string;
  url: string;
  status: number;
  statusText?: string;
  duration: number;
  size?: number;
  initiator: "fetch" | "xhr";
  error?: string;
  requestHeaders?: Record<string, string>;
  requestContentType?: string;
  requestBody?: string;
  requestBodyTruncated?: boolean;
  requestBodyNote?: string;
  responseHeaders?: Record<string, string>;
  responseContentType?: string;
  responseBody?: string;
  responseBodyTruncated?: boolean;
  responseBodyNote?: string;
};

export type SessionEvent =
  | PageEvent
  | ConsoleEvent
  | RuntimeErrorEvent
  | ClickEvent
  | FormInputEvent
  | FormSubmitEvent
  | KeyEvent
  | NavEvent
  | ScreenshotEvent
  | NoteEvent
  | NetworkEvent;

export type ActionEvent =
  | ClickEvent
  | FormInputEvent
  | FormSubmitEvent
  | KeyEvent
  | NavEvent
  | PageEvent
  | NoteEvent;

export const isActionEvent = (e: SessionEvent): e is ActionEvent =>
  e.type === "click" ||
  e.type === "input" ||
  e.type === "submit" ||
  e.type === "key" ||
  e.type === "nav" ||
  e.type === "page" ||
  e.type === "note";

export const isErrorEvent = (
  e: SessionEvent,
): e is RuntimeErrorEvent | (ConsoleEvent & { level: "error" }) =>
  e.type === "error" || (e.type === "console" && e.level === "error");

export const isFailedRequest = (e: SessionEvent): e is NetworkEvent =>
  e.type === "network" && (e.status === 0 || e.status >= 400);

/** Fold one event into the running counters. Mutates and returns `s`. */
export const accumulateStats = (s: SessionStats, e: SessionEvent, bytes: number): SessionStats => {
  s.events++;
  s.bytes += bytes;
  switch (e.type) {
    case "click":
    case "input":
    case "submit":
    case "key":
    case "nav":
      s.actions++;
      break;
    case "error":
      s.errors++;
      break;
    case "console":
      if (e.level === "error") s.errors++;
      else if (e.level === "warn") s.warnings++;
      break;
    case "network":
      s.requests++;
      if (e.status === 0 || e.status >= 400) s.failedRequests++;
      break;
    case "screenshot":
      s.shots++;
      break;
    case "note":
      s.notes++;
      break;
    case "page":
      break;
  }
  return s;
};
