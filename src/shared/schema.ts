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

export type SessionEvent = PageEvent | ConsoleEvent | RuntimeErrorEvent;
