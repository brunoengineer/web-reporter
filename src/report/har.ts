/**
 * HAR 1.2 export and cURL reconstruction. Pure functions.
 */
import type { NetworkEvent, SessionMeta } from "../shared/schema";

type HarHeader = { name: string; value: string };

const headersArray = (h: Record<string, string> | undefined): HarHeader[] =>
  Object.entries(h ?? {}).map(([name, value]) => ({ name, value }));

const queryString = (url: string): HarHeader[] => {
  try {
    return Array.from(new URL(url).searchParams.entries()).map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
};

export const buildHar = (events: NetworkEvent[], meta?: Pick<SessionMeta, "appVersion" | "title" | "startedAt">) => ({
  log: {
    version: "1.2",
    creator: { name: "Web Reporter", version: meta?.appVersion ?? "" },
    pages: meta
      ? [
          {
            startedDateTime: new Date(meta.startedAt).toISOString(),
            id: "page_1",
            title: meta.title || "Web Reporter session",
            pageTimings: {},
          },
        ]
      : [],
    entries: events.map((e) => {
      const reqBodySize = e.requestBody ? new TextEncoder().encode(e.requestBody).length : e.requestBodyNote ? -1 : 0;
      return {
        pageref: meta ? "page_1" : undefined,
        startedDateTime: new Date(e.ts).toISOString(),
        time: e.duration,
        request: {
          method: e.method,
          url: e.url,
          httpVersion: "HTTP/1.1",
          headers: headersArray(e.requestHeaders),
          queryString: queryString(e.url),
          cookies: [],
          headersSize: -1,
          bodySize: reqBodySize,
          ...(e.requestBody !== undefined
            ? { postData: { mimeType: e.requestContentType ?? "", text: e.requestBody } }
            : {}),
        },
        response: {
          status: e.status,
          statusText: e.statusText ?? "",
          httpVersion: "HTTP/1.1",
          headers: headersArray(e.responseHeaders),
          cookies: [],
          content: {
            size: e.size ?? (e.responseBody ? e.responseBody.length : -1),
            mimeType: e.responseContentType ?? "",
            ...(e.responseBody !== undefined ? { text: e.responseBody } : {}),
            ...(e.responseBodyTruncated ? { comment: "truncated by Web Reporter" } : {}),
          },
          redirectURL: e.responseHeaders?.location ?? "",
          headersSize: -1,
          bodySize: e.size ?? -1,
        },
        cache: {},
        timings: { blocked: -1, dns: -1, connect: -1, send: 0, wait: e.duration, receive: 0, ssl: -1 },
        ...(e.error ? { comment: e.error } : {}),
        _initiator: e.initiator,
      };
    }),
  },
});

const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** Rebuild a request as a cURL command. Redacted headers are kept as placeholders on purpose. */
export const buildCurl = (e: NetworkEvent): string => {
  const lines: string[] = [`curl${e.method !== "GET" ? ` -X ${e.method}` : ""} ${shq(e.url)}`];
  for (const [k, v] of Object.entries(e.requestHeaders ?? {})) {
    if (k === "content-length") continue;
    lines.push(`-H ${shq(`${k}: ${v}`)}`);
  }
  if (e.requestBody !== undefined && e.requestBody !== "") {
    lines.push(`--data-raw ${shq(e.requestBody)}`);
  }
  return lines.join(" \\\n  ");
};
