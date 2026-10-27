/**
 * MAIN-world script: wraps console / errors / history / fetch / XHR.
 *
 * Hooks are installed at document_start (so nothing is missed) but do no work — no body
 * cloning, no serialisation, no postMessage — until the isolated-world bridge says this tab
 * is being recorded. While the answer is still unknown (first few ms after load) events are
 * buffered briefly so early console errors on a recorded page aren't lost.
 */
import type {
  ConsoleEvent,
  ConsoleLevel,
  NavEvent,
  NetworkEvent,
  RuntimeErrorEvent,
  SessionEvent,
} from "../shared/schema";
import { DEFAULT_SETTINGS, type Settings } from "../shared/settings";
import { redactHeaders } from "../shared/redact";
import { CONTROL_TAG, EVENT_TAG } from "./protocol";

// ----- state -----

let settings: Settings = DEFAULT_SETTINGS;
/** null = unknown (bridge hasn't answered yet). */
let recording: boolean | null = null;
let pending: SessionEvent[] = [];
const PENDING_MAX = 200;
const PENDING_TTL_MS = 3000;

const post = (event: SessionEvent) => {
  if (recording === false) return;
  if (recording === null) {
    if (pending.length < PENDING_MAX) pending.push(event);
    return;
  }
  window.postMessage({ [EVENT_TAG]: true, event }, "*");
};

const active = (): boolean => recording !== false;

window.addEventListener("message", (e) => {
  if (e.source !== window) return;
  const data = e.data as Record<string, unknown> | null;
  if (!data || data[CONTROL_TAG] !== true) return;
  const cfg = data.config as { recording: boolean; settings: Settings } | undefined;
  if (!cfg) return;
  settings = { ...DEFAULT_SETTINGS, ...cfg.settings };
  const was = recording;
  recording = cfg.recording;
  if (was === null) {
    const flushable = pending;
    pending = [];
    if (recording) for (const ev of flushable) post(ev);
  }
});

// Give up on the buffer if nobody ever answers (page without the bridge, etc.).
setTimeout(() => {
  if (recording === null) {
    recording = false;
    pending = [];
  }
}, PENDING_TTL_MS);

// ----- console -----

const formatArg = (a: unknown, depth = 0): string => {
  if (a === null) return "null";
  if (a === undefined) return "undefined";
  if (typeof a === "string") return a;
  if (typeof a === "number" || typeof a === "boolean" || typeof a === "bigint") return String(a);
  if (typeof a === "symbol") return a.toString();
  if (typeof a === "function") return `[Function ${a.name || "anonymous"}]`;
  if (a instanceof Error) return a.stack ? a.stack : `${a.name}: ${a.message}`;
  if (a instanceof Element) return `<${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ""}>`;
  if (depth > 0 && typeof a === "object") return "[object]";
  try {
    const s = JSON.stringify(a, (_k, v: unknown) => (typeof v === "bigint" ? String(v) : v));
    return s === undefined ? String(a) : s.length > 10000 ? `${s.slice(0, 10000)}…` : s;
  } catch {
    return String(a);
  }
};

const formatArgs = (args: unknown[]): string => {
  // Honour the common `console.log("label %s", x)` pattern minimally: just join.
  return args.map((a) => formatArg(a)).join(" ");
};

const wrapConsole = (level: ConsoleLevel) => {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    if (active() && settings.captureConsole) {
      try {
        const ev: ConsoleEvent = { type: "console", ts: Date.now(), level, message: formatArgs(args) };
        post(ev);
      } catch {
        // never let our hook break the page
      }
    }
    return original(...args);
  };
};

(["log", "info", "warn", "error", "debug"] as const).forEach(wrapConsole);

window.addEventListener("error", (e) => {
  if (!active()) return;
  const ev: RuntimeErrorEvent = {
    type: "error",
    ts: Date.now(),
    message: e.message || "Script error",
    stack: e.error instanceof Error ? e.error.stack : undefined,
    source: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined,
  };
  post(ev);
});

window.addEventListener("unhandledrejection", (e) => {
  if (!active()) return;
  const reason = e.reason as unknown;
  const ev: RuntimeErrorEvent = {
    type: "error",
    ts: Date.now(),
    message: `Unhandled rejection: ${reason instanceof Error ? `${reason.name}: ${reason.message}` : formatArg(reason)}`,
    stack: reason instanceof Error ? reason.stack : undefined,
  };
  post(ev);
});

// ----- navigation -----

const emitNav = (kind: NavEvent["kind"]) => {
  if (!active()) return;
  const ev: NavEvent = { type: "nav", ts: Date.now(), url: location.href, kind };
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
window.addEventListener("hashchange", () => emitNav("hashchange"));

// ----- network: fetch + XHR (HAR-lite) -----

const maxBodyBytes = () => settings.maxBodyKb * 1024;

const headersToObject = (h: HeadersInit | null | undefined): Record<string, string> => {
  if (!h) return {};
  const out: Record<string, string> = {};
  if (h instanceof Headers) {
    h.forEach((v, k) => {
      out[k.toLowerCase()] = v;
    });
    return out;
  }
  if (Array.isArray(h)) {
    for (const pair of h) {
      if (pair && pair.length >= 2) out[String(pair[0]).toLowerCase()] = String(pair[1]);
    }
    return out;
  }
  for (const [k, v] of Object.entries(h as Record<string, string>)) out[k.toLowerCase()] = String(v);
  return out;
};

const parseRawHeaders = (raw: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    if (!k) continue;
    out[k] = line.slice(i + 1).trim();
  }
  return out;
};

const truncateBody = (s: string): { text: string; truncated: boolean } => {
  const max = maxBodyBytes();
  if (s.length <= max) return { text: s, truncated: false };
  return { text: s.slice(0, max), truncated: true };
};

type CapturedBody = { text?: string; truncated?: boolean; note?: string };

const captureRequestBody = (body: BodyInit | Document | null | undefined): CapturedBody => {
  if (body === null || body === undefined) return {};
  if (!settings.captureBodies) return { note: "body capture disabled in settings" };
  if (typeof body === "string") {
    const t = truncateBody(body);
    return { text: t.text, truncated: t.truncated || undefined };
  }
  if (body instanceof URLSearchParams) {
    const t = truncateBody(body.toString());
    return { text: t.text, truncated: t.truncated || undefined };
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const keys: string[] = [];
    body.forEach((_v, k) => keys.push(k));
    return { note: `FormData (${keys.length} field${keys.length === 1 ? "" : "s"}: ${keys.slice(0, 10).join(", ")})` };
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return { note: `Blob (${body.size} B${body.type ? `, ${body.type}` : ""})` };
  }
  if (body instanceof ArrayBuffer) return { note: `ArrayBuffer (${body.byteLength} B)` };
  if (ArrayBuffer.isView(body)) return { note: `binary (${body.byteLength} B)` };
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    return { note: "ReadableStream (not captured)" };
  }
  if (typeof Document !== "undefined" && body instanceof Document) return { note: "Document (not captured)" };
  return { note: "unknown body type" };
};

const isTextualContentType = (ct: string | undefined): boolean => {
  if (!ct) return true;
  const lower = ct.toLowerCase();
  return (
    lower.startsWith("text/") ||
    lower.includes("json") ||
    lower.includes("xml") ||
    lower.includes("javascript") ||
    lower.includes("x-www-form-urlencoded") ||
    lower.includes("graphql")
  );
};

type NetworkDetail = Pick<
  NetworkEvent,
  | "requestHeaders"
  | "requestContentType"
  | "requestBody"
  | "requestBodyTruncated"
  | "requestBodyNote"
  | "responseHeaders"
  | "responseContentType"
  | "responseBody"
  | "responseBodyTruncated"
  | "responseBodyNote"
>;

const buildNetworkEvent = (
  base: Pick<NetworkEvent, "method" | "url" | "status" | "ts" | "initiator">,
  startMs: number,
  extra: { statusText?: string; size?: number; error?: string },
  detail?: NetworkDetail,
): NetworkEvent => {
  const ev: NetworkEvent = { type: "network", ...base, duration: Math.round(performance.now() - startMs) };
  if (extra.statusText) ev.statusText = extra.statusText;
  if (extra.size !== undefined && !Number.isNaN(extra.size)) ev.size = extra.size;
  if (extra.error) ev.error = extra.error;
  if (detail) {
    for (const [k, v] of Object.entries(detail)) {
      if (v !== undefined && v !== false) (ev as unknown as Record<string, unknown>)[k] = v;
    }
  }
  return ev;
};

const resolveUrl = (input: RequestInfo | URL): string => {
  try {
    const raw =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input instanceof Request ? input.url : String(input);
    return new URL(raw, location.href).toString();
  } catch {
    return String(input);
  }
};

const origFetch = window.fetch.bind(window);
window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!active() || !settings.captureNetwork) return origFetch(input, init);

  const startMs = performance.now();
  const ts = Date.now();
  const method = (init?.method ?? (input instanceof Request ? input.method : undefined) ?? "GET").toUpperCase();
  const url = resolveUrl(input);

  let reqHeaders: Record<string, string> = {};
  if (init?.headers) reqHeaders = headersToObject(init.headers);
  else if (input instanceof Request) reqHeaders = headersToObject(input.headers);
  const requestContentType = reqHeaders["content-type"];

  let reqBody: CapturedBody = {};
  if (init?.body !== undefined && init?.body !== null) {
    reqBody = captureRequestBody(init.body);
  } else if (input instanceof Request && input.body !== null) {
    if (!settings.captureBodies) reqBody = { note: "body capture disabled in settings" };
    else {
      try {
        const t = truncateBody(await input.clone().text());
        reqBody = { text: t.text, truncated: t.truncated || undefined };
      } catch {
        reqBody = { note: "request body unreadable" };
      }
    }
  }

  const requestDetail: NetworkDetail = {
    requestHeaders: redactHeaders(reqHeaders),
    requestContentType,
    requestBody: reqBody.text,
    requestBodyTruncated: reqBody.truncated,
    requestBodyNote: reqBody.note,
  };

  let response: Response;
  try {
    response = await origFetch(input, init);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    try {
      post(buildNetworkEvent({ method, url, status: 0, ts, initiator: "fetch" }, startMs, { error: errMsg }, requestDetail));
    } catch {
      /* swallow */
    }
    throw err;
  }

  // Everything below is best-effort and must never affect the page's response.
  try {
    const respHeaders = headersToObject(response.headers);
    const responseContentType = respHeaders["content-type"];
    const cl = response.headers.get("content-length");
    const size = cl ? Number.parseInt(cl, 10) : undefined;

    let responseBody: string | undefined;
    let responseBodyTruncated: boolean | undefined;
    let responseBodyNote: string | undefined;
    if (!settings.captureBodies) {
      responseBodyNote = "body capture disabled in settings";
    } else if (response.type === "opaque") {
      responseBodyNote = "opaque response (no-cors)";
    } else if (isTextualContentType(responseContentType)) {
      try {
        const t = truncateBody(await response.clone().text());
        responseBody = t.text;
        if (t.truncated) responseBodyTruncated = true;
      } catch {
        responseBodyNote = "response body unreadable";
      }
    } else {
      responseBodyNote = `binary content-type: ${responseContentType ?? "unknown"}`;
    }

    post(
      buildNetworkEvent(
        { method, url, status: response.status, ts, initiator: "fetch" },
        startMs,
        { statusText: response.statusText, size },
        {
          ...requestDetail,
          responseHeaders: redactHeaders(respHeaders),
          responseContentType,
          responseBody,
          responseBodyTruncated,
          responseBodyNote,
        },
      ),
    );
  } catch {
    /* swallow */
  }
  return response;
};

type XHRMeta = {
  method: string;
  url: string;
  startMs: number;
  ts: number;
  requestHeaders: Record<string, string>;
  body: CapturedBody;
};
type WrXHR = XMLHttpRequest & { __wrMeta?: XHRMeta };

const origOpen = XMLHttpRequest.prototype.open;
const origSend = XMLHttpRequest.prototype.send;
const origSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

XMLHttpRequest.prototype.open = function (
  this: XMLHttpRequest,
  method: string,
  url: string | URL,
  async?: boolean,
  username?: string | null,
  password?: string | null,
): void {
  if (active() && settings.captureNetwork) {
    (this as WrXHR).__wrMeta = {
      method: String(method).toUpperCase(),
      url: resolveUrl(String(url)),
      startMs: 0,
      ts: 0,
      requestHeaders: {},
      body: {},
    };
  }
  return origOpen.call(this, method, url, async ?? true, username, password);
};

XMLHttpRequest.prototype.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string): void {
  const meta = (this as WrXHR).__wrMeta;
  if (meta) meta.requestHeaders[name.toLowerCase()] = value;
  return origSetRequestHeader.call(this, name, value);
};

XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null): void {
  const meta = (this as WrXHR).__wrMeta;
  if (meta) {
    meta.startMs = performance.now();
    meta.ts = Date.now();
    meta.body = captureRequestBody(body);

    this.addEventListener("loadend", () => {
      try {
        let size: number | undefined;
        let respHeaders: Record<string, string> = {};
        try {
          const raw = this.getAllResponseHeaders();
          if (raw) respHeaders = parseRawHeaders(raw);
          const cl = respHeaders["content-length"];
          if (cl) size = Number.parseInt(cl, 10);
        } catch {
          /* CORS can hide headers */
        }

        const responseContentType = respHeaders["content-type"];
        let responseBody: string | undefined;
        let responseBodyTruncated: boolean | undefined;
        let responseBodyNote: string | undefined;
        const rt = this.responseType;
        if (!settings.captureBodies) {
          responseBodyNote = "body capture disabled in settings";
        } else if (rt === "" || rt === "text") {
          try {
            const text = this.responseText;
            if (text) {
              const t = truncateBody(text);
              responseBody = t.text;
              if (t.truncated) responseBodyTruncated = true;
            }
          } catch {
            responseBodyNote = "response body unreadable";
          }
        } else if (rt === "json") {
          try {
            responseBody = JSON.stringify(this.response);
          } catch {
            responseBodyNote = "responseType=json (unserialisable)";
          }
        } else {
          responseBodyNote = `responseType=${rt}`;
        }

        const failed = this.status === 0;
        post(
          buildNetworkEvent(
            { method: meta.method, url: meta.url, status: this.status, ts: meta.ts, initiator: "xhr" },
            meta.startMs,
            { statusText: this.statusText, size, error: failed ? "network error or aborted" : undefined },
            {
              requestHeaders: redactHeaders(meta.requestHeaders),
              requestContentType: meta.requestHeaders["content-type"],
              requestBody: meta.body.text,
              requestBodyTruncated: meta.body.truncated,
              requestBodyNote: meta.body.note,
              responseHeaders: redactHeaders(respHeaders),
              responseContentType,
              responseBody,
              responseBodyTruncated,
              responseBodyNote,
            },
          ),
        );
      } catch {
        /* swallow */
      }
    });
  }
  return origSend.call(this, body);
};
