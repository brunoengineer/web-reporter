import type {
  ConsoleEvent,
  ConsoleLevel,
  NavEvent,
  RuntimeErrorEvent,
  SessionEvent,
} from "../shared/schema";

const TAG = "__wr_event__";

const post = (event: SessionEvent) => {
  window.postMessage({ [TAG]: true, event }, "*");
};

const formatArg = (a: unknown): string => {
  if (a === null) return "null";
  if (a === undefined) return "undefined";
  if (typeof a === "string") return a;
  if (typeof a === "number" || typeof a === "boolean" || typeof a === "bigint") return String(a);
  if (a instanceof Error) return `${a.name}: ${a.message}`;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
};

const formatArgs = (args: unknown[]): string => args.map(formatArg).join(" ");

const wrap = (level: ConsoleLevel) => {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    try {
      const ev: ConsoleEvent = {
        type: "console",
        ts: Date.now(),
        level,
        message: formatArgs(args),
      };
      post(ev);
    } catch {
      // never let our hook break the page
    }
    return original(...args);
  };
};

(["log", "info", "warn", "error", "debug"] as const).forEach(wrap);

window.addEventListener("error", (e) => {
  const ev: RuntimeErrorEvent = {
    type: "error",
    ts: Date.now(),
    message: e.message ?? "unknown error",
    stack: e.error instanceof Error ? e.error.stack : undefined,
    source: `${e.filename}:${e.lineno}:${e.colno}`,
  };
  post(ev);
});

window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason as unknown;
  const ev: RuntimeErrorEvent = {
    type: "error",
    ts: Date.now(),
    message: `Unhandled rejection: ${formatArg(reason)}`,
    stack: reason instanceof Error ? reason.stack : undefined,
  };
  post(ev);
});

const emitNav = (kind: NavEvent["kind"]) => {
  const ev: NavEvent = {
    type: "nav",
    ts: Date.now(),
    url: location.href,
    kind,
  };
  post(ev);
};

const origPushState = history.pushState.bind(history);
history.pushState = function (...args: Parameters<History["pushState"]>) {
  const ret = origPushState(...args);
  emitNav("pushstate");
  return ret;
};

const origReplaceState = history.replaceState.bind(history);
history.replaceState = function (...args: Parameters<History["replaceState"]>) {
  const ret = origReplaceState(...args);
  emitNav("replacestate");
  return ret;
};

window.addEventListener("popstate", () => emitNav("popstate"));
