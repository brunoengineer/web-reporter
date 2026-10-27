import { describe, expect, it } from "vitest";
import type { NetworkEvent, SessionEvent, SessionMeta } from "../shared/schema";
import { buildCurl, buildHar } from "../report/har";
import { buildMarkdown, buildStepsMarkdown, describeStepText } from "../report/markdown";
import type { ReportData } from "../report/model";

const T0 = 1_700_000_000_000;

const meta: SessionMeta = {
  id: "abc",
  state: "idle",
  startedAt: T0,
  title: "Login fails",
  severity: "high",
  notes: "Expected: dashboard\nActual: spinner",
  tab: null,
  appVersion: "0.2.0",
};

const net: NetworkEvent = {
  type: "network",
  ts: T0 + 2000,
  method: "POST",
  url: "https://api.example.com/auth/login?x=1",
  status: 500,
  statusText: "Internal Server Error",
  duration: 812,
  size: 120,
  initiator: "fetch",
  requestHeaders: { "content-type": "application/json", authorization: "[REDACTED]", "content-length": "17" },
  requestContentType: "application/json",
  requestBody: '{"email":"a@b.c"}',
  responseHeaders: { "content-type": "application/json" },
  responseContentType: "application/json",
  responseBody: '{"error":"it\'s broken"}',
};

const events: SessionEvent[] = [
  {
    type: "page",
    ts: T0,
    url: "https://example.com/login",
    title: "Login",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0 Safari/537.36",
    viewport: { w: 1440, h: 900 },
    screen: { w: 1920, h: 1080 },
    dpr: 2,
    language: "en-US",
    timezone: "Europe/Stockholm",
    platform: "Win32",
  },
  { type: "click", ts: T0 + 1000, selector: "form > button.btn", tag: "BUTTON", text: "Sign in" },
  net,
  { type: "error", ts: T0 + 2100, message: "TypeError: Cannot read 'token'", source: "auth.js:142:18" },
  { type: "screenshot", ts: T0 + 2500, id: "s1", kind: "manual" },
  { type: "key", ts: T0 + 3000, key: "Enter", selector: "#email" },
  { type: "note", ts: T0 + 3500, text: "spinner never stops" },
];

const data: ReportData = { meta, events, endedAt: T0 + 12_000 };

describe("buildHar", () => {
  it("produces a HAR 1.2 log with headers, bodies and page reference", () => {
    const har = buildHar([net], meta) as { log: Record<string, unknown> & { entries: Record<string, unknown>[] } };
    expect(har.log.version).toBe("1.2");
    expect((har.log.creator as { name: string }).name).toBe("Web Reporter");
    expect((har.log.pages as unknown[]).length).toBe(1);
    const entry = har.log.entries[0]!;
    const req = entry.request as Record<string, unknown>;
    const res = entry.response as Record<string, unknown>;
    expect(req.method).toBe("POST");
    expect(req.queryString).toEqual([{ name: "x", value: "1" }]);
    expect(req.headers).toContainEqual({ name: "authorization", value: "[REDACTED]" });
    expect((req.postData as { text: string }).text).toBe('{"email":"a@b.c"}');
    expect(res.status).toBe(500);
    expect(res.statusText).toBe("Internal Server Error");
    expect((res.content as { mimeType: string; text: string }).mimeType).toBe("application/json");
    expect((res.content as { text: string }).text).toContain("broken");
    expect((entry.timings as { wait: number }).wait).toBe(812);
    expect(entry._initiator).toBe("fetch");
  });

  it("is valid JSON end to end", () => {
    expect(() => JSON.parse(JSON.stringify(buildHar([net], meta)))).not.toThrow();
  });
});

describe("buildCurl", () => {
  it("rebuilds the request with method, headers and body", () => {
    const curl = buildCurl(net);
    expect(curl.startsWith("curl -X POST 'https://api.example.com/auth/login?x=1'")).toBe(true);
    expect(curl).toContain("-H 'content-type: application/json'");
    expect(curl).toContain("-H 'authorization: [REDACTED]'");
    expect(curl).not.toContain("content-length");
    expect(curl).toContain(`--data-raw '{"email":"a@b.c"}'`);
  });

  it("omits -X for GET and escapes single quotes", () => {
    const curl = buildCurl({ ...net, method: "GET", requestBody: "it's", requestHeaders: {} });
    expect(curl.startsWith("curl 'https://")).toBe(true);
    expect(curl).toContain(`--data-raw 'it'\\''s'`);
  });
});

describe("describeStepText", () => {
  it("describes every action type", () => {
    expect(describeStepText({ type: "click", ts: 0, selector: "#a", tag: "A", text: "Go" })).toBe('Click "Go" (`#a`)');
    expect(describeStepText({ type: "click", ts: 0, selector: "#a", tag: "A" })).toBe("Click `#a`");
    expect(describeStepText({ type: "input", ts: 0, selector: "#p", inputType: "password", length: 0, redacted: true })).toBe(
      "Type redacted value into `#p` (password)",
    );
    expect(describeStepText({ type: "input", ts: 0, selector: "#e", inputType: "email", length: 1, redacted: false })).toBe(
      "Type 1 char into `#e` (email)",
    );
    expect(describeStepText({ type: "key", ts: 0, key: "ArrowDown", selector: "#e" })).toBe("Press `Down` in `#e`");
    expect(describeStepText({ type: "note", ts: 0, text: "hm" })).toBe("Note: hm");
    expect(describeStepText({ type: "nav", ts: 0, url: "https://x/y", kind: "popstate" })).toBe("Navigate (popstate) to https://x/y");
  });
});

describe("buildMarkdown", () => {
  const md = buildMarkdown(data);

  it("starts with the title and key facts", () => {
    expect(md.startsWith("# Login fails\n")).toBe(true);
    expect(md).toContain("**Severity:** high");
    expect(md).toContain("**URL:** https://example.com/login");
    expect(md).toContain("**Environment:** Chrome 130.0 · Windows 10/11 · 1440×900 @2x · en-US · Europe/Stockholm");
    expect(md).toContain("1 error, 0 warnings, 1 failed request, 2 actions, 1 screenshot");
  });

  it("includes notes, steps with followups, errors and failed requests", () => {
    expect(md).toContain("## Notes\n\nExpected: dashboard\nActual: spinner");
    expect(md).toContain('2. Click "Sign in" (`form > button.btn`)');
    expect(md).toContain("   - ✗ POST /auth/login?x=1 → 500");
    expect(md).toContain("   - ⚠ TypeError: Cannot read 'token' (auth.js:142:18)");
    expect(md).toContain("   - 📷 Screenshot at ");
    expect(md).toContain("3. Press `Enter` in `#email`");
    expect(md).toContain("4. Note: spinner never stops");
    expect(md).toContain("## Errors (1)");
    expect(md).toContain("## Failed requests (1)");
    expect(md).toContain("| POST | 500 Internal Server Error |");
    expect(md).toContain("Generated by Web Reporter 0.2.0");
  });

  it("omits optional sections when empty", () => {
    const quiet = buildMarkdown({ ...data, meta: { ...meta, notes: "" }, events: [events[0]!, events[1]!] });
    expect(quiet).not.toContain("## Notes");
    expect(quiet).not.toContain("## Errors");
    expect(quiet).not.toContain("## Failed requests");
  });

  it("buildStepsMarkdown returns only the numbered list", () => {
    const steps = buildStepsMarkdown(data);
    expect(steps.startsWith("1. Open https://example.com/login")).toBe(true);
    expect(steps).not.toMatch(/^#/m); // no headings, just the list
  });
});
