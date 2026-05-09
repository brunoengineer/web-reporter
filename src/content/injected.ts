import type {
  ConsoleEvent,
  ConsoleLevel,
  NavEvent,
  NetworkEvent,
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

// ----- Network: fetch + XHR (HAR-lite) -----

const buildNetworkEvent = (
  method: string,
  url: string,
  status: number,
  ts: number,
  startMs: number,
  initiator: NetworkEvent["initiator"],
  size: number | undefined,
  error: string | undefined,
): NetworkEvent => {
  const ev: NetworkEvent = {
    type: "network",
    ts,
    method,
    url,
    status,
    duration: Math.round(performance.now() - startMs),
    initiator,
  };
  if (size !== undefined && !Number.isNaN(size)) ev.size = size;
  if (error) ev.error = error;
  return ev;
};

const origFetch = window.fetch.bind(window);
window.fetch = async function (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const startMs = performance.now();
  const ts = Date.now();
  const method = (
    init?.method ??
    (input instanceof Request ? input.method : undefined) ??
    "GET"
  ).toUpperCase();
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input instanceof Request
          ? input.url
          : String(input);

  try {
    const response = await origFetch(input, init);
    const cl = response.headers.get("content-length");
    const size = cl ? Number.parseInt(cl, 10) : undefined;
    try {
      post(buildNetworkEvent(method, url, response.status, ts, startMs, "fetch", size, undefined));
    } catch {
      // never let our hook break the page
    }
    return response;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    try {
      post(buildNetworkEvent(method, url, 0, ts, startMs, "fetch", undefined, errMsg));
    } catch {
      // swallow
    }
    throw err;
  }
};

type XHRMeta = { method: string; url: string; startMs: number; ts: number };
type WrXHR = XMLHttpRequest & { __wrMeta?: XHRMeta };

const origOpen = XMLHttpRequest.prototype.open;
const origSend = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open = function (
  this: XMLHttpRequest,
  method: string,
  url: string | URL,
  async?: boolean,
  username?: string | null,
  password?: string | null,
): void {
  (this as WrXHR).__wrMeta = {
    method: method.toUpperCase(),
    url: String(url),
    startMs: 0,
    ts: 0,
  };
  return origOpen.call(this, method, url, async ?? true, username, password);
};

XMLHttpRequest.prototype.send = function (
  this: XMLHttpRequest,
  body?: Document | XMLHttpRequestBodyInit | null,
): void {
  const meta = (this as WrXHR).__wrMeta;
  if (meta) {
    meta.startMs = performance.now();
    meta.ts = Date.now();
    this.addEventListener("loadend", () => {
      let size: number | undefined;
      try {
        const cl = this.getResponseHeader("content-length");
        if (cl) size = Number.parseInt(cl, 10);
      } catch {
        // some XHRs don't expose headers (CORS); ignore
      }
      try {
        post(
          buildNetworkEvent(meta.method, meta.url, this.status, meta.ts, meta.startMs, "xhr", size, undefined),
        );
      } catch {
        // swallow
      }
    });
  }
  return origSend.call(this, body);
};
