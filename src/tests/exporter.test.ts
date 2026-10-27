import { describe, expect, it } from "vitest";
import {
  buildReportHtml,
  escapeForJsonScript,
  escapeHtml,
  fileTimestamp,
  slugify,
  sortEvents,
  toDataUrl,
} from "../background/exporter";
import type { SessionEvent, SessionMeta } from "../shared/schema";

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml("&")).toBe("&amp;");
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml(">")).toBe("&gt;");
    expect(escapeHtml('"')).toBe("&quot;");
    expect(escapeHtml("'")).toBe("&#39;");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
    expect(escapeHtml("")).toBe("");
  });

  it("escapes mixed strings", () => {
    expect(escapeHtml('Tom & "Jerry" <hi>')).toBe("Tom &amp; &quot;Jerry&quot; &lt;hi&gt;");
  });
});

describe("escapeForJsonScript", () => {
  it("escapes </script tags so they can't terminate the host script", () => {
    expect(escapeForJsonScript("</script>")).toBe("<\\/script>");
    expect(escapeForJsonScript('</script src="x">')).toBe('<\\/script src="x">');
  });

  it("matches case-insensitively (replacement is always lowercase)", () => {
    expect(escapeForJsonScript("</SCRIPT>")).toBe("<\\/script>");
    expect(escapeForJsonScript("</Script>")).toBe("<\\/script>");
  });

  it("escapes HTML comment openers (they can confuse the HTML parser inside <script>)", () => {
    expect(escapeForJsonScript("<!-- hi")).toBe("\\u003c!-- hi");
  });

  it("leaves benign content alone", () => {
    expect(escapeForJsonScript('{"foo":"bar"}')).toBe('{"foo":"bar"}');
    expect(escapeForJsonScript("script tag in text")).toBe("script tag in text");
  });

  it("produces output JSON.parse still accepts", () => {
    const payload = JSON.stringify({ m: "</script><!--" });
    expect(JSON.parse(escapeForJsonScript(payload))).toEqual({ m: "</script><!--" });
  });
});

describe("slugify", () => {
  it("lowercases and joins with dashes", () => {
    expect(slugify("Login Bug")).toBe("login-bug");
    expect(slugify("My Cool Title 123")).toBe("my-cool-title-123");
  });

  it("collapses repeated separators", () => {
    expect(slugify("foo!!!bar___baz")).toBe("foo-bar-baz");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugify("...hello...")).toBe("hello");
    expect(slugify("---a---")).toBe("a");
  });

  it("falls back to 'session' on empty result", () => {
    expect(slugify("")).toBe("session");
    expect(slugify("!!!")).toBe("session");
    expect(slugify("   ")).toBe("session");
  });

  it("truncates to 40 characters", () => {
    const long = "a".repeat(100);
    expect(slugify(long).length).toBe(40);
  });
});

describe("fileTimestamp", () => {
  it("formats as YYYYMMDD-HHmm", () => {
    expect(fileTimestamp(new Date(2026, 0, 5, 9, 7))).toBe("20260105-0907");
  });
});

describe("sortEvents", () => {
  it("orders by timestamp and keeps insertion order for ties", () => {
    const events: SessionEvent[] = [
      { type: "console", ts: 3, level: "log", message: "c" },
      { type: "console", ts: 1, level: "log", message: "a1" },
      { type: "console", ts: 1, level: "log", message: "a2" },
      { type: "console", ts: 2, level: "log", message: "b" },
    ];
    const sorted = sortEvents(events).map((e) => (e as { message: string }).message);
    expect(sorted).toEqual(["a1", "a2", "b", "c"]);
  });
});

describe("toDataUrl", () => {
  it("round-trips UTF-8 content", () => {
    const html = "<p>héllo — ✓</p>";
    const url = toDataUrl(html);
    expect(url.startsWith("data:text/html;charset=utf-8;base64,")).toBe(true);
    const b64 = url.slice(url.indexOf(",") + 1);
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    expect(decoded).toBe(html);
  });

  it("handles inputs larger than one chunk", () => {
    const html = "x".repeat(100_000);
    const url = toDataUrl(html);
    const b64 = url.slice(url.indexOf(",") + 1);
    expect(atob(b64).length).toBe(100_000);
  });
});

describe("buildReportHtml", () => {
  const meta: SessionMeta = {
    id: "test-id",
    state: "recording",
    startedAt: 1700000000000,
    title: "Sample bug",
    severity: "medium",
    notes: "Steps:\n1. open page\n2. click",
    tab: { id: 1, windowId: 1, url: "https://example.com", title: "Example" },
    appVersion: "0.2.0",
  };

  it("produces a doctype HTML document with the title", () => {
    const html = buildReportHtml(meta, [], 1700000060000, {});
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Sample bug</title>");
    expect(html).toContain('<div id="app"></div>');
  });

  it("falls back to a default title when meta.title is empty", () => {
    const html = buildReportHtml({ ...meta, title: "" }, [], 0, {});
    expect(html).toContain("<title>Web Reporter — Bug Report</title>");
  });

  it("html-escapes the title", () => {
    const html = buildReportHtml({ ...meta, title: "<bad> & \"evil\"" }, [], 0, {});
    expect(html).toContain("<title>&lt;bad&gt; &amp; &quot;evil&quot;</title>");
  });

  it("inlines the session JSON inside the wr-session script tag", () => {
    const html = buildReportHtml(meta, [], 1700000060000, {});
    expect(html).toMatch(/<script id="wr-session" type="application\/json">.*"id":"test-id"/s);
    expect(html).toContain('"endedAt":1700000060000');
  });

  it("escapes </script in event data so it cannot break out", () => {
    const evilEvent: SessionEvent = {
      type: "console",
      ts: 1700000001000,
      level: "log",
      message: "</script><script>alert(1)</script>",
    };
    const html = buildReportHtml(meta, [evilEvent], 1700000060000, {});
    expect(html).not.toMatch(/<script id="wr-session"[^>]*>[^]*<\/script><script>alert/);
    expect(html).toContain("<\\/script>");
  });

  it("sorts events by timestamp in the embedded JSON", () => {
    const events: SessionEvent[] = [
      { type: "console", ts: 1700000002000, level: "log", message: "second" },
      { type: "console", ts: 1700000001000, level: "log", message: "first" },
    ];
    const html = buildReportHtml(meta, events, 1700000060000, {});
    expect(html.indexOf('"first"')).toBeLessThan(html.indexOf('"second"'));
  });

  it("includes the screenshots map", () => {
    const html = buildReportHtml(meta, [], 1700000060000, {
      "shot-1": "data:image/png;base64,abc",
    });
    expect(html).toContain('id="wr-screenshots"');
    expect(html).toContain('"shot-1":"data:image/png;base64,abc"');
  });
});
