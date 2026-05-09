import { describe, expect, it } from "vitest";
import { buildReportHtml, escapeForJsonScript, escapeHtml, slugify } from "../background/exporter";
import type { SessionMeta } from "../shared/schema";

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

  it("leaves benign content alone", () => {
    expect(escapeForJsonScript('{"foo":"bar"}')).toBe('{"foo":"bar"}');
    expect(escapeForJsonScript("script tag in text")).toBe("script tag in text");
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

describe("buildReportHtml", () => {
  const meta: SessionMeta = {
    id: "test-id",
    state: "recording",
    startedAt: 1700000000000,
    title: "Sample bug",
    severity: "medium",
    notes: "Steps:\n1. open page\n2. click",
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
    expect(html).toContain("\"endedAt\":1700000060000");
  });

  it("escapes </script in event data so it cannot break out", () => {
    const evilEvent = {
      type: "console" as const,
      ts: 1700000001000,
      level: "log" as const,
      message: "</script><script>alert(1)</script>",
    };
    const html = buildReportHtml(meta, [evilEvent], 1700000060000, {});
    // The malicious </script> must be escaped inside the JSON block
    expect(html).not.toMatch(/<script id="wr-session"[^>]*>[^]*<\/script><script>alert/);
    expect(html).toContain("<\\/script>");
  });

  it("includes the screenshots map", () => {
    const html = buildReportHtml(meta, [], 1700000060000, {
      "shot-1": "data:image/png;base64,abc",
    });
    expect(html).toContain('id="wr-screenshots"');
    expect(html).toContain('"shot-1":"data:image/png;base64,abc"');
  });
});
