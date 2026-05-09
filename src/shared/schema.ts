export type Severity = "low" | "medium" | "high";

export type SessionState = "idle" | "recording";

export type SessionMeta = {
  id: string;
  state: SessionState;
  startedAt: number;
  title: string;
  severity: Severity;
  notes: string;
};

export type PageEvent = {
  type: "page";
  ts: number;
  url: string;
  title: string;
  userAgent: string;
  viewport: { w: number; h: number };
  screen: { w: number; h: number };
  language: string;
  timezone: string;
  platform: string;
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

export type NavEvent = {
  type: "nav";
  ts: number;
  url: string;
  kind: "pushstate" | "replacestate" | "popstate";
};

export type SessionEvent =
  | PageEvent
  | ConsoleEvent
  | RuntimeErrorEvent
  | ClickEvent
  | FormInputEvent
  | FormSubmitEvent
  | NavEvent;
