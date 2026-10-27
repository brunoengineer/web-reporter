import { describe, expect, it } from "vitest";
import type { SessionEvent } from "../shared/schema";
import { accumulateStats, emptyStats } from "../shared/schema";
import {
  buildSteps,
  computeStats,
  consoleRows,
  dedupeSteps,
  failedRequests,
  fmtDuration,
  fmtOffset,
  fmtRel,
  groupErrors,
  niceTickInterval,
  normalizeEvents,
  parseUserAgent,
  shortUrl,
  statusBucket,
  uniquePages,
} from "../report/model";

const T0 = 1_700_000_000_000;

const sample = (): SessionEvent[] => [
  {
    type: "page",
    ts: T0,
    url: "https://example.com/login",
    title: "Login",
    userAgent: "ua",
    viewport: { w: 1, h: 1 },
    screen: { w: 1, h: 1 },
    language: "en",
    timezone: "UTC",
    platform: "Win32",
  },
  { type: "console", ts: T0 + 500, level: "error", message: "boot error" }, // orphan: before 1st action
  { type: "click", ts: T0 + 1000, selector: "#a", tag: "BUTTON", text: "Go" },
  { type: "input", ts: T0 + 1500, selector: "#email", inputType: "email", length: 3, redacted: false },
  { type: "input", ts: T0 + 1600, selector: "#email", inputType: "email", length: 9, redacted: false },
  { type: "network", ts: T0 + 2000, method: "POST", url: "https://api.example.com/x", status: 500, duration: 10, initiator: "fetch" },
  { type: "error", ts: T0 + 2100, message: "TypeError: x is undefined", source: "a.js:1:1" },
  { type: "console", ts: T0 + 2200, level: "error", message: "TypeError: x is undefined" },
  { type: "console", ts: T0 + 2300, level: "error", message: "TypeError: x is undefined" },
  { type: "console", ts: T0 + 2400, level: "warn", message: "careful" },
  { type: "screenshot", ts: T0 + 2500, id: "s1", kind: "manual" },
  { type: "note", ts: T0 + 3000, text: "spinner stuck" },
  { type: "nav", ts: T0 + 3500, url: "https://example.com/home", kind: "pushstate" },
  { type: "network", ts: T0 + 3600, method: "GET", url: "https://api.example.com/y", status: 200, duration: 40, size: 100, initiator: "xhr" },
  { type: "network", ts: T0 + 3700, method: "GET", url: "https://api.example.com/z", status: 0, duration: 5, initiator: "fetch", error: "Failed to fetch" },
];

describe("formatting", () => {
  it("fmtRel renders m:ss.t relative to start", () => {
    expect(fmtRel(T0, T0)).toBe("0:00.0");
    expect(fmtRel(T0 + 5_250, T0)).toBe("0:05.2");
    expect(fmtRel(T0 + 65_000, T0)).toBe("1:05.0");
    expect(fmtRel(T0 - 100, T0)).toBe("0:00.0");
  });

  it("fmtDuration picks the right unit", () => {
    expect(fmtDuration(0)).toBe("0s");
    expect(fmtDuration(400)).toBe("400 ms");
    expect(fmtDuration(12_000)).toBe("12s");
    expect(fmtDuration(125_000)).toBe("2m 5s");
    expect(fmtDuration(3_725_000)).toBe("1h 2m 5s");
  });

  it("fmtOffset is compact", () => {
    expect(fmtOffset(0)).toBe("0s");
    expect(fmtOffset(30_000)).toBe("30s");
    expect(fmtOffset(60_000)).toBe("1m");
    expect(fmtOffset(90_000)).toBe("1m30s");
  });

  it("shortUrl drops the scheme and trims from the middle", () => {
    expect(shortUrl("https://example.com/")).toBe("example.com");
    expect(shortUrl("https://example.com/a/b?c=1")).toBe("example.com/a/b?c=1");
    const long = `https://example.com/${"x".repeat(200)}/end`;
    const s = shortUrl(long, 40);
    expect(s.length).toBe(40);
    expect(s).toContain("…");
    expect(s.endsWith("/end")).toBe(true);
  });

  it("niceTickInterval returns a sensible step", () => {
    expect(niceTickInterval(10_000, 8)).toBe(2000);
    expect(niceTickInterval(600_000, 8)).toBe(120_000);
    expect(niceTickInterval(100, 8)).toBe(100);
  });

  it("statusBucket classifies HTTP statuses", () => {
    expect(statusBucket(0)).toBe("fail");
    expect(statusBucket(200)).toBe("ok");
    expect(statusBucket(301)).toBe("redirect");
    expect(statusBucket(404)).toBe("client");
    expect(statusBucket(503)).toBe("server");
  });
});

describe("parseUserAgent", () => {
  it("detects Chrome on Windows", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.70 Safari/537.36";
    expect(parseUserAgent(ua)).toEqual({ browser: "Chrome", browserVersion: "130.0", os: "Windows 10/11", device: "desktop" });
  });

  it("prefers Edge over Chrome when both tokens exist", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.56";
    expect(parseUserAgent(ua).browser).toBe("Edge");
    expect(parseUserAgent(ua).browserVersion).toBe("130.0");
  });

  it("detects Safari on macOS", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
    const r = parseUserAgent(ua);
    expect(r.browser).toBe("Safari");
    expect(r.browserVersion).toBe("17.4");
    expect(r.os).toBe("macOS 10.15");
  });

  it("detects mobile Android", () => {
    const ua = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36";
    const r = parseUserAgent(ua);
    expect(r.os).toBe("Android 14");
    expect(r.device).toBe("mobile");
  });

  it("falls back to platform for unknown UAs", () => {
    expect(parseUserAgent("curl/8.0", "FreeBSD").os).toBe("FreeBSD");
  });
});

describe("normalizeEvents", () => {
  it("sorts by ts, stable on ties", () => {
    const evs: SessionEvent[] = [
      { type: "console", ts: 2, level: "log", message: "b" },
      { type: "console", ts: 1, level: "log", message: "a1" },
      { type: "console", ts: 1, level: "log", message: "a2" },
    ];
    expect(normalizeEvents(evs).map((e) => (e as { message: string }).message)).toEqual(["a1", "a2", "b"]);
  });
});

describe("computeStats", () => {
  it("counts every category", () => {
    const s = computeStats(sample());
    expect(s.errors).toBe(4); // 1 runtime + 3 console.error
    expect(s.runtimeErrors).toBe(1);
    expect(s.warnings).toBe(1);
    expect(s.clicks).toBe(1);
    expect(s.inputs).toBe(2);
    expect(s.navs).toBe(1);
    expect(s.actions).toBe(4);
    expect(s.notes).toBe(1);
    expect(s.shots).toBe(1);
    expect(s.pages).toBe(1);
    expect(s.network).toBe(3);
    expect(s.netOk).toBe(1);
    expect(s.net5xx).toBe(1);
    expect(s.netFail).toBe(1);
    expect(s.netBytes).toBe(100);
    expect(s.netMaxDuration).toBe(40);
  });
});

describe("accumulateStats (popup counters)", () => {
  it("matches computeStats for the shared categories", () => {
    const s = emptyStats();
    for (const e of sample()) accumulateStats(s, e, JSON.stringify(e).length);
    const full = computeStats(sample());
    expect(s.events).toBe(sample().length);
    expect(s.errors).toBe(full.errors);
    expect(s.warnings).toBe(full.warnings);
    expect(s.actions).toBe(full.actions);
    expect(s.requests).toBe(full.network);
    expect(s.failedRequests).toBe(full.net4xx + full.net5xx + full.netFail);
    expect(s.shots).toBe(full.shots);
    expect(s.notes).toBe(full.notes);
    expect(s.bytes).toBeGreaterThan(0);
  });
});

describe("buildSteps", () => {
  it("groups followups under the preceding action and attaches orphans to the first step", () => {
    const steps = buildSteps(sample());
    const types = steps.map((s) => s.event.type);
    expect(types).toEqual(["page", "click", "input", "input", "note", "nav"]);

    // the orphan console error (ts+500) is attached to the first step
    expect(steps[0]!.followups.map((f) => f.event.type)).toEqual(["console"]);

    // 2nd input (ts+1600) is followed by: 500 POST, runtime error, 2 console errors (warn is not a followup), screenshot
    const f = steps[3]!.followups.map((x) => x.event.type);
    expect(f).toEqual(["network", "error", "console", "console", "screenshot"]);

    // nav is followed by the failed GET only (200 is not a followup)
    expect(steps[5]!.followups.map((x) => x.event.type)).toEqual(["network"]);
  });

  it("keeps global indexes so revealers can be looked up", () => {
    const events = sample();
    const steps = buildSteps(events);
    for (const s of steps) expect(events[s.index]).toBe(s.event);
    for (const s of steps) for (const f of s.followups) expect(events[f.index]).toBe(f.event);
  });

  it("returns an empty list when there are no actions", () => {
    expect(buildSteps([{ type: "console", ts: 1, level: "log", message: "x" }])).toEqual([]);
  });
});

describe("dedupeSteps", () => {
  it("collapses consecutive inputs on the same field, keeping the last", () => {
    const steps = dedupeSteps(buildSteps(sample()));
    const inputs = steps.filter((s) => s.event.type === "input");
    expect(inputs.length).toBe(1);
    expect((inputs[0]!.event as { length: number }).length).toBe(9);
  });

  it("does not collapse when the first input has followups", () => {
    const evs: SessionEvent[] = [
      { type: "input", ts: 1, selector: "#a", inputType: "text", length: 1, redacted: false },
      { type: "console", ts: 2, level: "error", message: "x" },
      { type: "input", ts: 3, selector: "#a", inputType: "text", length: 2, redacted: false },
    ];
    expect(dedupeSteps(buildSteps(evs)).length).toBe(2);
  });
});

describe("groupErrors", () => {
  it("groups identical messages, counts them and sorts by count", () => {
    const groups = groupErrors(sample());
    expect(groups.length).toBe(3);
    expect(groups[0]!.message).toBe("TypeError: x is undefined");
    expect(groups[0]!.kind).toBe("console");
    expect(groups[0]!.count).toBe(2);
    expect(groups.find((g) => g.kind === "runtime")?.source).toBe("a.js:1:1");
  });

  it("normalises volatile numbers and URLs when grouping", () => {
    const evs: SessionEvent[] = [
      { type: "console", ts: 1, level: "error", message: "Request 12345 to https://a.com/x failed" },
      { type: "console", ts: 2, level: "error", message: "Request 99999 to https://b.com/y failed" },
    ];
    expect(groupErrors(evs).length).toBe(1);
  });
});

describe("consoleRows", () => {
  it("collapses consecutive identical messages with a repeat count", () => {
    const rows = consoleRows(sample());
    const dup = rows.find((r) => r.event.message === "TypeError: x is undefined" && !r.isRuntime);
    expect(dup?.repeat).toBe(2);
    // the runtime error with the same text is a separate row
    expect(rows.filter((r) => r.event.message === "TypeError: x is undefined").length).toBe(2);
  });
});

describe("failedRequests / uniquePages", () => {
  it("returns 4xx/5xx/network-failed requests with indexes", () => {
    const f = failedRequests(sample());
    expect(f.map((x) => x.event.status)).toEqual([500, 0]);
  });

  it("lists unique page URLs from page + nav events", () => {
    expect(uniquePages(sample())).toEqual(["https://example.com/login", "https://example.com/home"]);
  });
});
