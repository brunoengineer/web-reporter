import type {
  ConsoleEvent,
  ConsoleLevel,
  NavEvent,
  NetworkEvent,
  RuntimeErrorEvent,
  SessionEvent,
} from "../shared/schema";
import { redactHeaders } from "../shared/redact";

const TAG = "__wr_event__";

const MAX_BODY_BYTES = 64 * 1024;

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
  for (const [k, v] of Object.entries(h as Record<string, string>)) {
    out[k.toLowerCase()] = String(v);
  }
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
  if (s.length <= MAX_BODY_BYTES) return { text: s, truncated: false };
  return { text: s.slice(0, MAX_BODY_BYTES), truncated: true };
};

type CapturedBody = { text?: string; truncated?: boolean; note?: string };

const captureRequestBody = (
  body: BodyInit | Document | null | undefined,
): CapturedBody => {
  if (body === null || body === undefined) return {};
  if (typeof body === "string") {
    const t = truncateBody(body);
    return { text: t.text, truncated: t.truncated || undefined };
  }
  if (body instanceof URLSearchParams) {
    const t = truncateBody(body.toString());
    return { text: t.text, truncated: t.truncated || undefined };
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return { note: "FormData (not captured)" };
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return { note: `Blob (${body.size} B${body.type ? `, ${body.type}` : ""})` };
  }
  if (body instanceof ArrayBuffer) {
    return { note: `ArrayBuffer (${body.byteLength} B)` };
  }
  if (ArrayBuffer.isView(body)) {
    return { note: `binary (${body.byteLength} B)` };
  }
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    return { note: "ReadableStream (not captured)" };
  }
  if (typeof Document !== "undefined" && body instanceof Document) {
    return { note: "Document (not captured)" };
  }
  return { note: "unknown body type" };
};

const isTextualContentType = (ct: string | undefined): boolean => {
  if (!ct) return true;
  const lower = ct.toLowerCase();
  if (lower.startsWith("text/")) return true;
  if (lower.includes("json")) return true;
  if (lower.includes("xml")) return true;
  if (lower.includes("javascript")) return true;
  if (lower.includes("x-www-form-urlencoded")) return true;
  return false;
};

type NetworkDetail = {
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

const buildNetworkEvent = (
  method: string,
  url: string,
  status: number,
  ts: number,
  startMs: number,
  initiator: NetworkEvent["initiator"],
  size: number | undefined,
  error: string | undefined,
  detail?: NetworkDetail,
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
  if (detail) {
    if (detail.requestHeaders) ev.requestHeaders = detail.requestHeaders;
    if (detail.requestContentType) ev.requestContentType = detail.requestContentType;
    if (detail.requestBody !== undefined) ev.requestBody = detail.requestBody;
    if (detail.requestBodyTruncated) ev.requestBodyTruncated = true;
    if (detail.requestBodyNote) ev.requestBodyNote = detail.requestBodyNote;
    if (detail.responseHeaders) ev.responseHeaders = detail.responseHeaders;
    if (detail.responseContentType) ev.responseContentType = detail.responseContentType;
    if (detail.responseBody !== undefined) ev.responseBody = detail.responseBody;
    if (detail.responseBodyTruncated) ev.responseBodyTruncated = true;
    if (detail.responseBodyNote) ev.responseBodyNote = detail.responseBodyNote;
  }
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

  // Request headers
  let reqHeaders: Record<string, string> = {};
  if (init?.headers) reqHeaders = headersToObject(init.headers);
  else if (input instanceof Request) reqHeaders = headersToObject(input.headers);
  const requestContentType = reqHeaders["content-type"];

  // Request body — prefer init.body; otherwise clone Request.body if present
  let reqBody: CapturedBody = {};
  if (init?.body !== undefined && init?.body !== null) {
    reqBody = captureRequestBody(init.body);
  } else if (input instanceof Request) {
    if (input.body !== null) {
      try {
        const text = await input.clone().text();
        const t = truncateBody(text);
        reqBody = { text: t.text, truncated: t.truncated || undefined };
      } catch {
        reqBody = { note: "request body unreadable" };
      }
    }
  }

  try {
    const response = await origFetch(input, init);

    const respHeaders = headersToObject(response.headers);
    const responseContentType = respHeaders["content-type"];
    const cl = response.headers.get("content-length");
    const size = cl ? Number.parseInt(cl, 10) : undefined;

    let respBody: string | undefined;
    let respTruncated: boolean | undefined;
    let respNote: string | undefined;
    if (isTextualContentType(responseContentType)) {
      try {
        const text = await response.clone().text();
        const t = truncateBody(text);
        respBody = t.text;
        if (t.truncated) respTruncated = true;
      } catch {
        respNote = "response body unreadable";
      }
    } else {
      respNote = `binary content-type: ${responseContentType ?? "unknown"}`;
    }

    try {
      post(
        buildNetworkEvent(method, url, response.status, ts, startMs, "fetch", size, undefined, {
          requestHeaders: redactHeaders(reqHeaders),
          requestContentType,
          requestBody: reqBody.text,
          requestBodyTruncated: reqBody.truncated,
          requestBodyNote: reqBody.note,
          responseHeaders: redactHeaders(respHeaders),
          responseContentType,
          responseBody: respBody,
          responseBodyTruncated: respTruncated,
          responseBodyNote: respNote,
        }),
      );
    } catch {
      // never let our hook break the page
    }
    return response;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    try {
      post(
        buildNetworkEvent(method, url, 0, ts, startMs, "fetch", undefined, errMsg, {
          requestHeaders: redactHeaders(reqHeaders),
          requestContentType,
          requestBody: reqBody.text,
          requestBodyTruncated: reqBody.truncated,
          requestBodyNote: reqBody.note,
        }),
      );
    } catch {
      // swallow
    }
    throw err;
  }
};

type XHRMeta = {
  method: string;
  url: string;
  startMs: number;
  ts: number;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  requestBodyTruncated?: boolean;
  requestBodyNote?: string;
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
  (this as WrXHR).__wrMeta = {
    method: method.toUpperCase(),
    url: String(url),
    startMs: 0,
    ts: 0,
    requestHeaders: {},
  };
  return origOpen.call(this, method, url, async ?? true, username, password);
};

XMLHttpRequest.prototype.setRequestHeader = function (
  this: XMLHttpRequest,
  name: string,
  value: string,
): void {
  const meta = (this as WrXHR).__wrMeta;
  if (meta) meta.requestHeaders[name.toLowerCase()] = value;
  return origSetRequestHeader.call(this, name, value);
};

XMLHttpRequest.prototype.send = function (
  this: XMLHttpRequest,
  body?: Document | XMLHttpRequestBodyInit | null,
): void {
  const meta = (this as WrXHR).__wrMeta;
  if (meta) {
    meta.startMs = performance.now();
    meta.ts = Date.now();

    const captured = captureRequestBody(body);
    meta.requestBody = captured.text;
    meta.requestBodyTruncated = captured.truncated;
    meta.requestBodyNote = captured.note;

    this.addEventListener("loadend", () => {
      let size: number | undefined;
      let respHeaders: Record<string, string> = {};
      try {
        const raw = this.getAllResponseHeaders();
        if (raw) respHeaders = parseRawHeaders(raw);
        const cl = respHeaders["content-length"];
        if (cl) size = Number.parseInt(cl, 10);
      } catch {
        // some XHRs don't expose headers (CORS); ignore
      }

      const responseContentType = respHeaders["content-type"];
      let respBody: string | undefined;
      let respTruncated: boolean | undefined;
      let respNote: string | undefined;
      const rt = this.responseType;
      if (rt === "" || rt === "text") {
        try {
          const text = this.responseText;
          if (text) {
            const t = truncateBody(text);
            respBody = t.text;
            if (t.truncated) respTruncated = true;
          }
        } catch {
          respNote = "response body unreadable";
        }
      } else {
        respNote = `responseType=${rt}`;
      }

      try {
        post(
          buildNetworkEvent(meta.method, meta.url, this.status, meta.ts, meta.startMs, "xhr", size, undefined, {
            requestHeaders: redactHeaders(meta.requestHeaders),
            requestContentType: meta.requestHeaders["content-type"],
            requestBody: meta.requestBody,
            requestBodyTruncated: meta.requestBodyTruncated,
            requestBodyNote: meta.requestBodyNote,
            responseHeaders: redactHeaders(respHeaders),
            responseContentType,
            responseBody: respBody,
            responseBodyTruncated: respTruncated,
            responseBodyNote: respNote,
          }),
        );
      } catch {
        // swallow
      }
    });
  }
  return origSend.call(this, body);
};
